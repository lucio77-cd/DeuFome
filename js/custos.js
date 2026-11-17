// Deu Fome — custos e margem (painel do restaurante).
// Ingredientes (preço de compra), receita de cada produto e margem. Tudo é PRIVADO: as coleções
// "ingredientes" e "receitas" só o restaurante lê (firestore.rules). O cálculo fica em js/custo-calculo.js.
// Quando o preço de um ingrediente muda, as receitas que o usam são recalculadas aqui; os pedidos já feitos
// NÃO mudam, porque o servidor copiou o custo para dentro do pedido na hora da venda (api/criar-pedido.js).
import { auth, db } from "./firebase-config.js";
import { $, criar, formatarMoeda, executar, mensagemErroFirebase, toast } from "./utils.js";
import {
  UNIDADES, ROTULO_BASE, unidadesDaBase, lerDecimal, microDeReais, custoMicroPorBase, quantidadeEmBase,
  custoReceitaMicro, receitasQueUsam, margemDoProduto, formatarMicro, formatarMicroPreciso, formatarPercentual
} from "./custo-calculo.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, deleteDoc, doc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const porNome = (a, b) => String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");

let carga = 0;          // descarta respostas antigas ao trocar de conta
let restauranteId = "";
let ingredientes = [];  // { id, nome, unidade, precoMicro, base, custoMicroPorBase, criadoEm }
let receitas = [];      // { id (= produtoId), itens, custoExtraMicro, custoMicro }
let produtos = [];      // só os ativos (não arquivados)
let linhas = [];        // editor de receita: { ingredienteId, quantidade (texto), unidade }

const caminho = (nome) => collection(db, "restaurantes", restauranteId, nome);

// ---------- Utilidades ----------
function mapaIngredientes() {
  const mapa = {};
  ingredientes.forEach((i) => { mapa[i.id] = i; });
  return mapa;
}

// Mostra a quantidade guardada (em g/ml/un) na unidade mais legível: 1500 g -> 1,5 kg
function quantidadeParaTela(quantidadeBase, base) {
  if ((base === "g" || base === "ml") && quantidadeBase >= 1000) {
    return { quantidade: String(quantidadeBase / 1000).replace(".", ","), unidade: base === "g" ? "kg" : "l" };
  }
  return { quantidade: String(quantidadeBase).replace(".", ","), unidade: base };
}

const textoPreco = (micro) => (micro / 1000000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 });

function opcoesUnidade(unidades) {
  return unidades.map((u) => criar("option", { value: u, texto: UNIDADES[u].rotulo }));
}

// ---------- 1. Ingredientes ----------
function desenharIngredientes() {
  const lista = $("#listaIngredientes");
  if (!ingredientes.length) {
    lista.replaceChildren(criar("p", { class: "texto-suave", texto: "Nenhum ingrediente ainda. Cadastre o primeiro acima." }));
    return;
  }
  lista.replaceChildren(...ingredientes.map((i) => {
    const usadoEm = receitasQueUsam(receitas, i.id).length;
    return criar("div", { class: "item-lista" },
      criar("div", {},
        criar("strong", { texto: i.nome }),
        criar("small", { texto: `${formatarMicroPreciso(i.precoMicro)} por ${i.unidade} · ${formatarMicroPreciso(i.custoMicroPorBase)} por ${ROTULO_BASE[i.base]}` +
          (usadoEm ? ` · usado em ${usadoEm} receita(s)` : "") })),
      criar("div", { class: "acoes-item" },
        criar("button", { class: "btn btn-secundario btn-pequeno", type: "button", texto: "Editar", "data-editar": i.id }),
        criar("button", { class: "btn btn-perigo btn-pequeno", type: "button", texto: "Excluir", "data-excluir": i.id })));
  }));
}

function limparFormIngrediente() {
  $("#ingredienteForm").reset();
  $("#ingredienteId").value = "";
  $("#cancelarIngrediente").classList.add("oculto");
  $("#salvarIngrediente").textContent = "Salvar ingrediente";
  atualizarRotuloUnidade();
}

function atualizarRotuloUnidade() {
  $("#rotuloUnidade").textContent = $("#ingredienteUnidade").value || "kg";
}

// Recalcula e grava as receitas que usam o ingrediente (preço novo -> custo novo da receita)
async function recalcularReceitasDe(ingredienteId) {
  const afetadas = receitasQueUsam(receitas, ingredienteId);
  if (!afetadas.length) return 0;
  const mapa = mapaIngredientes();
  const lote = writeBatch(db);
  const novas = afetadas.map((r) => {
    const itens = r.itens.map((item) => (mapa[item.ingredienteId] ? { ...item, nome: mapa[item.ingredienteId].nome } : item));
    const { custoMicro } = custoReceitaMicro(itens, mapa, r.custoExtraMicro || 0);
    lote.set(doc(caminho("receitas"), r.id), { itens, custoExtraMicro: r.custoExtraMicro || 0, custoMicro, atualizadoEm: serverTimestamp() });
    return { ...r, itens, custoMicro };
  });
  await lote.commit();
  novas.forEach((n) => { receitas = receitas.map((r) => (r.id === n.id ? n : r)); });
  return novas.length;
}

async function salvarIngrediente() {
  const id = $("#ingredienteId").value;
  const nome = $("#ingredienteNome").value.replace(/\s+/g, " ").trim();
  const unidade = $("#ingredienteUnidade").value;
  const preco = lerDecimal($("#ingredientePreco").value);
  if (nome.length < 1 || nome.length > 60) throw new Error("Informe o nome do ingrediente (até 60 letras).");
  if (!UNIDADES[unidade]) throw new Error("Escolha a unidade de compra.");
  if (preco === null || preco <= 0 || preco > 100000) throw new Error("Informe um preço válido, maior que zero. Ex.: 32,00");
  if (ingredientes.some((i) => i.id !== id && i.nome.toLowerCase() === nome.toLowerCase())) {
    throw new Error("Já existe um ingrediente com esse nome.");
  }
  const base = UNIDADES[unidade].base;
  const existente = ingredientes.find((i) => i.id === id);
  if (existente && existente.base !== base && receitasQueUsam(receitas, id).length) {
    throw new Error(`Este ingrediente já está em receitas medidas em ${ROTULO_BASE[existente.base]}. Não dá para trocar para ${ROTULO_BASE[base]}: remova-o das receitas antes.`);
  }
  const precoMicro = microDeReais(preco);
  const dados = { nome, unidade, precoMicro, base, custoMicroPorBase: custoMicroPorBase(precoMicro, unidade), ativo: true };
  const referencia = existente ? doc(caminho("ingredientes"), id) : doc(caminho("ingredientes"));
  // Edição usa updateDoc: o criadoEm que já está no banco fica intacto (a regra exige que ele não mude).
  // Com setDoc, um ingrediente criado e editado na mesma tela mandaria criadoEm vazio e seria negado.
  if (existente) await updateDoc(referencia, { ...dados, atualizadoEm: serverTimestamp() });
  else await setDoc(referencia, { ...dados, criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp() });
  const novo = { ...dados, id: referencia.id, criadoEm: existente ? existente.criadoEm : null };
  ingredientes = existente ? ingredientes.map((i) => (i.id === id ? novo : i)) : [...ingredientes, novo];
  ingredientes.sort(porNome);
  const atualizadas = existente ? await recalcularReceitasDe(id) : 0;
  limparFormIngrediente();
  desenharTudo();
  toast(atualizadas ? `Ingrediente salvo. ${atualizadas} receita(s) recalculada(s).` : "Ingrediente salvo.", "sucesso");
}

function editarIngrediente(id) {
  const i = ingredientes.find((x) => x.id === id);
  if (!i) return;
  $("#ingredienteId").value = i.id;
  $("#ingredienteNome").value = i.nome;
  $("#ingredienteUnidade").value = i.unidade;
  $("#ingredientePreco").value = textoPreco(i.precoMicro);
  $("#cancelarIngrediente").classList.remove("oculto");
  $("#salvarIngrediente").textContent = "Atualizar ingrediente";
  atualizarRotuloUnidade();
  $("#ingredienteNome").focus();
}

async function excluirIngrediente(id) {
  const i = ingredientes.find((x) => x.id === id);
  if (!i) return;
  const usos = receitasQueUsam(receitas, id);
  if (usos.length) {
    const nomes = usos.map((r) => (produtos.find((p) => p.id === r.id) || {}).nome || "produto").join(", ");
    throw new Error(`"${i.nome}" está nas receitas de: ${nomes}. Tire dessas receitas antes de excluir.`);
  }
  if (!confirm(`Excluir o ingrediente "${i.nome}"?`)) return;
  await deleteDoc(doc(caminho("ingredientes"), id));
  ingredientes = ingredientes.filter((x) => x.id !== id);
  if ($("#ingredienteId").value === id) limparFormIngrediente();
  desenharTudo();
  toast("Ingrediente excluído.", "sucesso");
}

// ---------- 2. Receita do produto ----------
function produtoDaReceita() {
  return produtos.find((p) => p.id === $("#receitaProduto").value);
}

function carregarEditor() {
  const produto = produtoDaReceita();
  $("#editorReceita").classList.toggle("oculto", !produto);
  $("#avisoReceita").textContent = "";
  if (!produto) return;
  const receita = receitas.find((r) => r.id === produto.id);
  linhas = receita
    ? receita.itens.map((item) => ({ ingredienteId: item.ingredienteId, ...quantidadeParaTela(item.quantidadeBase, item.unidadeBase) }))
    : [];
  $("#receitaExtra").value = receita && receita.custoExtraMicro ? textoPreco(receita.custoExtraMicro) : "";
  $("#excluirReceita").classList.toggle("oculto", !receita);
  desenharLinhas();
}

function desenharLinhas() {
  const lista = $("#linhasReceita");
  if (!linhas.length) {
    lista.replaceChildren(criar("p", { class: "texto-suave", texto: ingredientes.length
      ? "Nenhum ingrediente nesta receita. Toque em “Adicionar ingrediente”."
      : "Cadastre ingredientes na seção 1 para montar a receita." }));
    atualizarResumo();
    return;
  }
  lista.replaceChildren(...linhas.map((linha, n) => {
    const ing = ingredientes.find((i) => i.id === linha.ingredienteId);
    const seletor = criar("select", { "data-campo": "ingredienteId", "data-linha": String(n), "aria-label": "Ingrediente" },
      criar("option", { value: "", texto: "Escolha o ingrediente" }),
      ...ingredientes.map((i) => criar("option", { value: i.id, texto: i.nome })));
    seletor.value = linha.ingredienteId;
    const unidades = ing ? unidadesDaBase(ing.base) : ["g"];
    const unidade = criar("select", { "data-campo": "unidade", "data-linha": String(n), "aria-label": "Unidade" }, ...opcoesUnidade(unidades));
    unidade.value = unidades.includes(linha.unidade) ? linha.unidade : unidades[0];
    linha.unidade = unidade.value;
    return criar("div", { class: "linha-receita" },
      seletor,
      criar("input", { value: linha.quantidade, inputMode: "decimal", placeholder: "Qtd.", "data-campo": "quantidade", "data-linha": String(n), "aria-label": "Quantidade" }),
      unidade,
      criar("button", { class: "btn btn-perigo btn-pequeno", type: "button", texto: "✕", "data-remover": String(n), "aria-label": "Remover ingrediente" }));
  }));
  atualizarResumo();
}

// Monta os itens da receita a partir do editor. Devolve { itens, erros }.
function itensDoEditor() {
  const itens = [];
  const erros = [];
  linhas.forEach((linha, n) => {
    const ing = ingredientes.find((i) => i.id === linha.ingredienteId);
    const quantidade = lerDecimal(linha.quantidade);
    if (!ing) erros.push(`Linha ${n + 1}: escolha o ingrediente.`);
    else if (quantidade === null || quantidade <= 0) erros.push(`Linha ${n + 1}: informe a quantidade.`);
    else itens.push({ ingredienteId: ing.id, nome: ing.nome, quantidadeBase: quantidadeEmBase(quantidade, linha.unidade), unidadeBase: ing.base });
  });
  return { itens, erros };
}

function atualizarResumo() {
  const produto = produtoDaReceita();
  const resumo = $("#resumoReceita");
  if (!produto) { resumo.replaceChildren(); return; }
  const { itens } = itensDoEditor();
  const extra = lerDecimal($("#receitaExtra").value);
  const { custoMicro } = custoReceitaMicro(itens, mapaIngredientes(), extra ? microDeReais(extra) : 0);
  const m = margemDoProduto(produto.precoCentavos, custoMicro);
  resumo.replaceChildren(
    criar("div", { class: "resumo-linha" }, criar("span", { texto: "Preço de venda" }), criar("span", { texto: formatarMoeda(produto.precoCentavos) })),
    criar("div", { class: "resumo-linha" }, criar("span", { texto: "Custo da receita" }), criar("span", { texto: formatarMicro(custoMicro) })),
    criar("div", { class: "resumo-linha total" },
      criar("span", { texto: "Lucro por unidade" }),
      criar("span", { class: classeMargem(m.margemPercentual), texto: `${formatarMicro(m.lucroCentavos * 10000)} (${formatarPercentual(m.margemPercentual)})` })));
}

async function salvarReceita() {
  const produto = produtoDaReceita();
  if (!produto) return;
  const { itens, erros } = itensDoEditor();
  const extraTexto = $("#receitaExtra").value.trim();
  const extra = extraTexto ? lerDecimal(extraTexto) : 0;
  if (extra === null || extra > 10000) erros.push("Outros custos: informe um valor válido. Ex.: 0,50");
  if (!itens.length && !extra) erros.push("Adicione pelo menos um ingrediente ou um custo extra.");
  if (itens.length > 40) erros.push("No máximo 40 ingredientes por receita.");
  if (erros.length) { $("#avisoReceita").textContent = erros[0]; return; }
  $("#avisoReceita").textContent = "";
  const extraMicro = microDeReais(extra);
  const { custoMicro, problemas } = custoReceitaMicro(itens, mapaIngredientes(), extraMicro);
  if (problemas.length) { $("#avisoReceita").textContent = "Há ingrediente com problema (apagado ou com unidade trocada). Remova e adicione de novo."; return; }
  await setDoc(doc(caminho("receitas"), produto.id), { itens, custoExtraMicro: extraMicro, custoMicro, atualizadoEm: serverTimestamp() });
  const nova = { id: produto.id, itens, custoExtraMicro: extraMicro, custoMicro };
  receitas = receitas.some((r) => r.id === produto.id) ? receitas.map((r) => (r.id === produto.id ? nova : r)) : [...receitas, nova];
  $("#excluirReceita").classList.remove("oculto");
  desenharTudo(false);
  toast("Receita salva. Os próximos pedidos já usam este custo.", "sucesso");
}

async function excluirReceita() {
  const produto = produtoDaReceita();
  if (!produto || !confirm(`Remover a receita de "${produto.nome}"? Os próximos pedidos desse produto ficam sem custo.`)) return;
  await deleteDoc(doc(caminho("receitas"), produto.id));
  receitas = receitas.filter((r) => r.id !== produto.id);
  linhas = [];
  $("#receitaExtra").value = "";
  $("#excluirReceita").classList.add("oculto");
  desenharTudo(false);
  desenharLinhas();
  toast("Receita removida.", "sucesso");
}

// ---------- 3. Margem dos produtos ----------
// Verde: boa margem. Amarelo: apertada. Vermelho: prejuízo.
function classeMargem(pct) {
  return pct < 0 ? "margem-ruim" : pct < 20 ? "margem-media" : "margem-boa";
}

function desenharMargens() {
  const lista = $("#listaMargens");
  if (!produtos.length) {
    lista.replaceChildren(criar("p", { class: "texto-suave", texto: "Cadastre produtos no painel para ver a margem." }));
    return;
  }
  lista.replaceChildren(...produtos.map((p) => {
    const receita = receitas.find((r) => r.id === p.id);
    if (!receita) {
      return criar("div", { class: "item-lista" },
        criar("div", {}, criar("strong", { texto: p.nome }), criar("small", { texto: `Venda ${formatarMoeda(p.precoCentavos)} · sem receita` })),
        criar("span", { class: "selo selo-aviso", texto: "sem custo" }));
    }
    const m = margemDoProduto(p.precoCentavos, receita.custoMicro);
    return criar("div", { class: "item-lista" },
      criar("div", {}, criar("strong", { texto: p.nome }),
        criar("small", { texto: `Venda ${formatarMoeda(p.precoCentavos)} · custo ${formatarMicro(receita.custoMicro)}` })),
      criar("div", { class: "margem-valor" },
        criar("strong", { class: classeMargem(m.margemPercentual), texto: formatarMicro(m.lucroCentavos * 10000) }),
        criar("small", { class: classeMargem(m.margemPercentual), texto: formatarPercentual(m.margemPercentual) })));
  }));
}

// ---------- Tela ----------
function desenharTudo(recarregarSeletor = true) {
  desenharIngredientes();
  desenharMargens();
  if (recarregarSeletor) {
    const atual = $("#receitaProduto").value;
    $("#receitaProduto").replaceChildren(
      criar("option", { value: "", texto: produtos.length ? "Escolha o produto" : "Nenhum produto cadastrado" }),
      ...produtos.map((p) => criar("option", { value: p.id, texto: `${p.nome} — ${formatarMoeda(p.precoCentavos)}` })));
    $("#receitaProduto").value = produtos.some((p) => p.id === atual) ? atual : "";
    carregarEditor();
  }
}

async function carregarRestaurante(id) {
  const minha = ++carga;
  restauranteId = id;
  $("#conteudo").classList.add("oculto");
  $("#erroCarga").classList.add("oculto");
  try {
    const [ing, rec, prod] = await Promise.all([
      getDocs(caminho("ingredientes")), getDocs(caminho("receitas")), getDocs(caminho("produtos"))
    ]);
    if (minha !== carga) return;
    ingredientes = ing.docs.map((d) => ({ ...d.data(), id: d.id })).sort(porNome);
    receitas = rec.docs.map((d) => ({ ...d.data(), id: d.id }));
    produtos = prod.docs.map((d) => ({ ...d.data(), id: d.id })).filter((p) => p.ativo !== false).sort(porNome);
    limparFormIngrediente();
    desenharTudo();
    $("#conteudo").classList.remove("oculto");
  } catch (erro) {
    if (minha !== carga) return;
    $("#erroCarga").textContent = mensagemErroFirebase(erro);
    $("#erroCarga").classList.remove("oculto");
  }
}

// ---------- Eventos ----------
$("#ingredienteUnidade").replaceChildren(...opcoesUnidade(Object.keys(UNIDADES)));
$("#ingredienteUnidade").value = "kg";
$("#ingredienteUnidade").addEventListener("change", atualizarRotuloUnidade);
$("#ingredienteForm").addEventListener("submit", (e) => {
  e.preventDefault();
  executar($("#salvarIngrediente"), salvarIngrediente);
});
$("#cancelarIngrediente").addEventListener("click", limparFormIngrediente);
$("#listaIngredientes").addEventListener("click", (e) => {
  const editar = e.target.closest("button[data-editar]");
  const excluir = e.target.closest("button[data-excluir]");
  if (editar) editarIngrediente(editar.dataset.editar);
  if (excluir) executar(excluir, () => excluirIngrediente(excluir.dataset.excluir));
});

$("#receitaProduto").addEventListener("change", carregarEditor);
$("#addLinha").addEventListener("click", () => {
  if (!ingredientes.length) { toast("Cadastre um ingrediente primeiro (seção 1).", "aviso"); return; }
  linhas.push({ ingredienteId: "", quantidade: "", unidade: "g" });
  desenharLinhas();
});
$("#linhasReceita").addEventListener("click", (e) => {
  const remover = e.target.closest("button[data-remover]");
  if (!remover) return;
  linhas.splice(Number(remover.dataset.remover), 1);
  desenharLinhas();
});
$("#linhasReceita").addEventListener("input", (e) => {
  const campo = e.target.dataset.campo;
  const linha = linhas[Number(e.target.dataset.linha)];
  if (!linha) return;
  if (campo === "quantidade") { linha.quantidade = e.target.value; atualizarResumo(); }
});
$("#linhasReceita").addEventListener("change", (e) => {
  const campo = e.target.dataset.campo;
  const linha = linhas[Number(e.target.dataset.linha)];
  if (!linha) return;
  if (campo === "ingredienteId") {
    linha.ingredienteId = e.target.value;
    const ing = ingredientes.find((i) => i.id === linha.ingredienteId);
    linha.unidade = ing ? unidadesDaBase(ing.base)[0] : "g"; // ao trocar de ingrediente, volta para a unidade menor (g, ml ou un)
    desenharLinhas();
  } else if (campo === "unidade") {
    linha.unidade = e.target.value;
    atualizarResumo();
  }
});
$("#receitaExtra").addEventListener("input", atualizarResumo);
$("#salvarReceita").addEventListener("click", (e) => executar(e.currentTarget, salvarReceita));
$("#excluirReceita").addEventListener("click", (e) => executar(e.currentTarget, excluirReceita));
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
