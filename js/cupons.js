// Deu Fome — cupons de desconto (painel do restaurante).
// Os cupons ficam em restaurantes/{id}/cupons/{CODIGO} e são PRIVADOS (firestore.rules): o cliente nunca os lê.
// Ele digita o código no carrinho e o servidor (/api/validar-cupom e /api/criar-pedido) confere e calcula.
// "usos" só o servidor altera (soma ao pedir, devolve ao cancelar): este painel nunca grava esse campo ao editar.
import { auth, db } from "./firebase-config.js";
import { $, criar, formatarMoeda, paraCentavos, executar, mensagemErroFirebase, toast } from "./utils.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, Timestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ROTULO_TIPO = { percentual: "Porcentagem", fixo: "Valor fixo", frete_gratis: "Frete grátis" };

let carga = 0;          // descarta respostas antigas ao trocar de conta
let restauranteId = "";
let cupons = [];        // { id (= código), tipo, valor, minimoCentavos, validadeAte, limiteUsos, usos, ativo }

const caminho = () => collection(db, "restaurantes", restauranteId, "cupons");

// Mesma regra do servidor (api/_cupom.js): maiúsculas, só letras e números, 3 a 20
const limparCodigo = (texto) => String(texto || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);

// Fim do dia escolhido (horário do aparelho). "2026-12-31" -> 31/12 às 23:59:59
function fimDoDia(textoData) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(textoData || "");
  if (!m) return null;
  return Timestamp.fromDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59));
}

function paraCampoData(ts) {
  if (!ts || typeof ts.toDate !== "function") return "";
  const d = ts.toDate();
  const dois = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
}

function situacao(c) {
  if (c.ativo !== true) return { texto: "pausado", classe: "selo" };
  if (c.validadeAte && typeof c.validadeAte.toMillis === "function" && c.validadeAte.toMillis() < Date.now()) return { texto: "vencido", classe: "selo selo-erro" };
  if (Number.isInteger(c.limiteUsos) && (c.usos || 0) >= c.limiteUsos) return { texto: "esgotado", classe: "selo selo-aviso" };
  return { texto: "ativo", classe: "selo selo-ok" };
}

function descricao(c) {
  const partes = [];
  if (c.tipo === "percentual") partes.push(`${c.valor}% de desconto`);
  else if (c.tipo === "fixo") partes.push(`${formatarMoeda(c.valor)} de desconto`);
  else partes.push("frete grátis");
  if (c.minimoCentavos > 0) partes.push(`mínimo ${formatarMoeda(c.minimoCentavos)}`);
  partes.push(Number.isInteger(c.limiteUsos) ? `${c.usos || 0} de ${c.limiteUsos} usos` : `${c.usos || 0} usos`);
  if (c.validadeAte && typeof c.validadeAte.toDate === "function") partes.push(`até ${c.validadeAte.toDate().toLocaleDateString("pt-BR")}`);
  return partes.join(" · ");
}

function desenhar() {
  const lista = $("#listaCupons");
  if (!cupons.length) {
    lista.replaceChildren(criar("p", { class: "texto-suave", texto: "Nenhum cupom ainda. Crie o primeiro acima." }));
    return;
  }
  lista.replaceChildren(...cupons.map((c) => {
    const s = situacao(c);
    return criar("div", { class: "item-lista" },
      criar("div", {},
        criar("strong", { texto: c.id }), " ", criar("span", { class: s.classe, texto: s.texto }),
        criar("small", { texto: descricao(c) })),
      criar("div", { class: "acoes-item" },
        criar("button", { class: "btn btn-secundario btn-pequeno", type: "button", texto: c.ativo === true ? "Pausar" : "Ativar", "data-alternar": c.id }),
        criar("button", { class: "btn btn-secundario btn-pequeno", type: "button", texto: "Editar", "data-editar": c.id }),
        criar("button", { class: "btn btn-perigo btn-pequeno", type: "button", texto: "Excluir", "data-excluir": c.id })));
  }));
}

function ajustarCampoValor() {
  const tipo = $("#cupomTipo").value;
  $("#blocoValor").classList.toggle("oculto", tipo === "frete_gratis");
  $("#rotuloValor").textContent = tipo === "percentual" ? "Desconto (%)" : "Desconto (R$)";
  $("#cupomValor").placeholder = tipo === "percentual" ? "Ex.: 10" : "Ex.: 5,00";
}

function limparForm() {
  $("#cupomForm").reset();
  $("#cupomEditando").value = "";
  $("#cupomCodigo").disabled = false;
  $("#tituloForm").textContent = "Novo cupom";
  $("#salvarCupom").textContent = "Criar cupom";
  $("#cancelarEdicao").classList.add("oculto");
  ajustarCampoValor();
}

// Lê e valida o formulário. Devolve os campos do cupom (sem criadoEm/usos/atualizadoEm).
function lerFormulario() {
  const codigo = limparCodigo($("#cupomCodigo").value);
  if (codigo.length < 3) throw new Error("O código precisa ter de 3 a 20 letras ou números, sem espaço.");

  const tipo = $("#cupomTipo").value;
  if (!ROTULO_TIPO[tipo]) throw new Error("Escolha o tipo de desconto.");

  let valor = 0;
  if (tipo === "percentual") {
    const texto = $("#cupomValor").value.trim().replace("%", "");
    valor = /^\d{1,3}$/.test(texto) ? Number(texto) : NaN;
    if (!(valor >= 1 && valor <= 100)) throw new Error("A porcentagem precisa ser um número inteiro de 1 a 100. Ex.: 10");
  } else if (tipo === "fixo") {
    const centavos = paraCentavos($("#cupomValor").value);
    if (centavos === null || centavos < 1 || centavos > 1000000) throw new Error("Informe um valor de desconto válido. Ex.: 5,00");
    valor = centavos;
  }

  let minimoCentavos = 0;
  if ($("#cupomMinimo").value.trim()) {
    minimoCentavos = paraCentavos($("#cupomMinimo").value);
    if (minimoCentavos === null || minimoCentavos < 0 || minimoCentavos > 1000000) throw new Error("Pedido mínimo inválido. Ex.: 30,00");
  }

  let limiteUsos = null;
  if ($("#cupomLimite").value.trim()) {
    const texto = $("#cupomLimite").value.trim();
    limiteUsos = /^\d{1,6}$/.test(texto) ? Number(texto) : NaN;
    if (!(limiteUsos >= 1 && limiteUsos <= 100000)) throw new Error("O limite de usos precisa ser um número de 1 a 100000, ou fique em branco.");
  }

  const validadeAte = fimDoDia($("#cupomValidade").value);
  if ($("#cupomValidade").value && !validadeAte) throw new Error("Data de validade inválida.");

  return { codigo, tipo, valor, minimoCentavos, validadeAte, limiteUsos, ativo: $("#cupomAtivo").checked };
}

async function salvar() {
  const editando = $("#cupomEditando").value;
  const dados = lerFormulario();

  if (editando) {
    // updateDoc: não manda "usos" nem "criadoEm" (a regra exige que fiquem como estão)
    await updateDoc(doc(caminho(), editando), {
      tipo: dados.tipo, valor: dados.valor, minimoCentavos: dados.minimoCentavos,
      validadeAte: dados.validadeAte, limiteUsos: dados.limiteUsos, ativo: dados.ativo,
      atualizadoEm: serverTimestamp()
    });
    cupons = cupons.map((c) => (c.id === editando ? { ...c, ...dados, id: editando } : c));
    toast("Cupom atualizado.", "sucesso");
  } else {
    if (cupons.some((c) => c.id === dados.codigo)) throw new Error("Já existe um cupom com esse código. Edite-o na lista abaixo.");
    await setDoc(doc(caminho(), dados.codigo), { ...dados, usos: 0, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
    cupons = [{ ...dados, id: dados.codigo, usos: 0 }, ...cupons];
    toast(`Cupom ${dados.codigo} criado.`, "sucesso");
  }
  limparForm();
  desenhar();
}

function editar(id) {
  const c = cupons.find((x) => x.id === id);
  if (!c) return;
  $("#cupomEditando").value = c.id;
  $("#cupomCodigo").value = c.id;
  $("#cupomCodigo").disabled = true; // o código é o identificador: para trocar, crie outro cupom
  $("#cupomTipo").value = c.tipo;
  ajustarCampoValor();
  $("#cupomValor").value = c.tipo === "percentual" ? String(c.valor) : c.tipo === "fixo" ? (c.valor / 100).toFixed(2).replace(".", ",") : "";
  $("#cupomMinimo").value = c.minimoCentavos > 0 ? (c.minimoCentavos / 100).toFixed(2).replace(".", ",") : "";
  $("#cupomLimite").value = Number.isInteger(c.limiteUsos) ? String(c.limiteUsos) : "";
  $("#cupomValidade").value = paraCampoData(c.validadeAte);
  $("#cupomAtivo").checked = c.ativo === true;
  $("#tituloForm").textContent = `Editar cupom ${c.id}`;
  $("#salvarCupom").textContent = "Salvar alterações";
  $("#cancelarEdicao").classList.remove("oculto");
  $("#cupomForm").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function alternar(id) {
  const c = cupons.find((x) => x.id === id);
  if (!c) return;
  const ativo = c.ativo !== true;
  await updateDoc(doc(caminho(), id), { ativo, atualizadoEm: serverTimestamp() });
  cupons = cupons.map((x) => (x.id === id ? { ...x, ativo } : x));
  desenhar();
  toast(ativo ? `Cupom ${id} ativado.` : `Cupom ${id} pausado.`, "sucesso");
}

async function excluir(id) {
  if (!confirm(`Excluir o cupom ${id}? Pedidos já feitos com ele não mudam.`)) return;
  await deleteDoc(doc(caminho(), id));
  cupons = cupons.filter((c) => c.id !== id);
  if ($("#cupomEditando").value === id) limparForm();
  desenhar();
  toast("Cupom excluído.", "sucesso");
}

async function carregarRestaurante(id) {
  const minha = ++carga;
  restauranteId = id;
  $("#conteudo").classList.add("oculto");
  $("#erroCarga").classList.add("oculto");
  try {
    const snapshot = await getDocs(caminho());
    if (minha !== carga) return;
    cupons = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }))
      .sort((a, b) => (b.criadoEm && b.criadoEm.toMillis ? b.criadoEm.toMillis() : 0) - (a.criadoEm && a.criadoEm.toMillis ? a.criadoEm.toMillis() : 0));
    limparForm();
    desenhar();
    $("#conteudo").classList.remove("oculto");
  } catch (erro) {
    if (minha !== carga) return;
    $("#erroCarga").textContent = mensagemErroFirebase(erro);
    $("#erroCarga").classList.remove("oculto");
  }
}

// ---------- Eventos ----------
$("#cupomCodigo").addEventListener("input", (e) => { e.target.value = limparCodigo(e.target.value); });
$("#cupomTipo").addEventListener("change", ajustarCampoValor);
$("#cupomForm").addEventListener("submit", (e) => {
  e.preventDefault();
  executar($("#salvarCupom"), salvar);
});
$("#cancelarEdicao").addEventListener("click", limparForm);
$("#listaCupons").addEventListener("click", (e) => {
  const botaoEditar = e.target.closest("button[data-editar]");
  const botaoAlternar = e.target.closest("button[data-alternar]");
  const botaoExcluir = e.target.closest("button[data-excluir]");
  if (botaoEditar) editar(botaoEditar.dataset.editar);
  if (botaoAlternar) executar(botaoAlternar, () => alternar(botaoAlternar.dataset.alternar));
  if (botaoExcluir) executar(botaoExcluir, () => excluir(botaoExcluir.dataset.excluir));
});
$("#seletorRestaurante").addEventListener("change", (e) => carregarRestaurante(e.target.value));

onAuthStateChanged(auth, async (user) => {
  const minha = ++carga;
  $("#semLogin").classList.toggle("oculto", !!user);
  $("#app").classList.toggle("oculto", !user);
  $("#semVinculo").classList.add("oculto");
  $("#seletorArea").classList.add("oculto");
  $("#conteudo").classList.add("oculto");
  if (!user) return;
  try {
    const snapshot = await getDocs(collection(db, "usuarios", user.uid, "restaurantes"));
    if (minha !== carga) return;
    const vinculos = snapshot.docs.map((d) => ({ ...d.data(), id: d.id })).filter((v) => v.ativo !== false);
    if (!vinculos.length) { $("#semVinculo").classList.remove("oculto"); return; }
    $("#seletorRestaurante").replaceChildren(...vinculos.map((v) => criar("option", { value: v.id, texto: v.nome || v.id })));
    $("#seletorArea").classList.toggle("oculto", vinculos.length < 2);
    carregarRestaurante(vinculos[0].id);
  } catch (erro) {
    if (minha !== carga) return;
    $("#erroCarga").textContent = mensagemErroFirebase(erro);
    $("#erroCarga").classList.remove("oculto");
  }
});
