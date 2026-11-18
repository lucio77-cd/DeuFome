// Deu Fome — pedidos recebidos pelo restaurante, em tempo real.
// "Em andamento" é escutado ao vivo; o histórico (pedidos encerrados) é carregado por dia.
// A tela só mostra/esconde; quem protege os dados é o firestore.rules.
import { auth, db } from "./firebase-config.js";
import { $, criar, formatarMoeda, formatarDataHora, formatarTelefone, ROTULO_STATUS, STATUS_PEDIDO, executar, mensagemErroFirebase, toast, chamarApi } from "./utils.js";
import { suportado, permissao, ativar, desativar, sincronizar } from "./notificacoes.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, getDocs, limit, onSnapshot, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const lista = $("#lista");
const listaHistorico = $("#listaHistorico");
const FUSO = "America/Sao_Paulo";

// Próximo passo de cada status (cancelar é um botão à parte)
const PROXIMO = {
  novo: { status: STATUS_PEDIDO.PREPARANDO, rotulo: "Aceitar e preparar" },
  preparando: { status: STATUS_PEDIDO.SAIU, rotulo: "Saiu para entrega" },
  saiu_para_entrega: { status: STATUS_PEDIDO.ENTREGUE, rotulo: "Marcar como entregue" }
};
const EM_ANDAMENTO = [STATUS_PEDIDO.NOVO, STATUS_PEDIDO.PREPARANDO, STATUS_PEDIDO.SAIU];
const SELO = { novo: "selo-aviso", preparando: "", saiu_para_entrega: "", entregue: "selo-ok", cancelado: "selo-erro" };
const FORMAS = { dinheiro: "Dinheiro", cartao: "Cartão (maquininha)", pix: "Pix" };

let carga = 0;          // descarta respostas antigas ao trocar de conta
let escutaId = 0;       // descarta respostas antigas ao trocar de restaurante
let historicoId = 0;    // descarta respostas antigas do histórico
let cancelarEscuta = null;
let restauranteAtual = "";
let pedidos = [];       // só os em andamento
let primeiraCarga = true;
let avisosAtivos = false;

// Data de hoje no fuso de Brasília (AAAA-MM-DD)
function hoje() {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO }).format(new Date());
}

function pararEscuta() {
  escutaId++;
  historicoId++;
  if (cancelarEscuta) cancelarEscuta();
  cancelarEscuta = null;
  restauranteAtual = "";
  pedidos = [];
  avisosAtivos = false;
}

// Um único AudioContext reaproveitado: criar um novo a cada pedido vaza recurso (o navegador limita a quantidade)
let audio = null;

function apitar() {
  try {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return;
    if (!audio) audio = new Contexto();
    if (audio.state === "suspended") audio.resume();
    const oscilador = audio.createOscillator();
    const volume = audio.createGain();
    oscilador.connect(volume);
    volume.connect(audio.destination);
    oscilador.frequency.value = 880;
    volume.gain.value = 0.15;
    oscilador.start();
    oscilador.stop(audio.currentTime + 0.25);
  } catch (erro) { /* o navegador pode bloquear som sem toque na tela */ }
}

const milissegundos = (p) => (p.criadoEm && typeof p.criadoEm.toMillis === "function" ? p.criadoEm.toMillis() : 0);

function cartao(p) {
  const proximo = PROXIMO[p.status];
  const itens = Array.isArray(p.itens) ? p.itens : [];
  const cliente = p.cliente || {};
  const entrega = p.entrega || {};
  const pagamento = p.pagamento || {};
  const telefone = String(cliente.telefone || "");
  const troco = pagamento.forma === "dinheiro" && pagamento.trocoParaCentavos
    ? ` · troco para ${formatarMoeda(pagamento.trocoParaCentavos)}` : "";
  const pediuCancelar = p.cancelamentoSolicitado === true && EM_ANDAMENTO.includes(p.status);

  return criar("article", { class: "card pedido-cartao" + (p.status === STATUS_PEDIDO.NOVO ? " pedido-novo" : "") },
    criar("div", { class: "pedido-cabecalho" },
      criar("strong", { texto: `Pedido #${p.numero ?? "?"}` }),
      criar("span", { class: `selo ${SELO[p.status] || ""}`.trim(), texto: ROTULO_STATUS[p.status] || p.status })),
    criar("small", { class: "texto-suave", texto: formatarDataHora(p.criadoEm) }),
    pediuCancelar ? criar("p", { class: "mensagem erro", texto: "⚠️ O cliente pediu o cancelamento deste pedido." }) : "",
    criar("p", {},
      criar("strong", { texto: cliente.nome || "Cliente" }), " · ",
      criar("a", { href: `tel:${telefone}`, texto: formatarTelefone(telefone) }), " · ",
      criar("a", { href: `https://wa.me/55${telefone}`, target: "_blank", rel: "noopener", texto: "WhatsApp" })),
    criar("p", { texto: `📍 ${entrega.endereco || ""}${entrega.referencia ? ` — ${entrega.referencia}` : ""}` }),
    criar("ul", { class: "pedido-itens" },
      ...itens.map((i) => criar("li", { texto: `${i.quantidade}× ${i.nome} — ${formatarMoeda(i.subtotalCentavos)}` }))),
    p.observacao ? criar("p", { class: "mensagem aviso", texto: `Obs.: ${p.observacao}` }) : "",
    p.cupom && p.cupom.codigo
      ? criar("p", { class: "pedido-cupom", texto: `🎟️ Cupom ${p.cupom.codigo}${p.descontoCentavos > 0 ? `: − ${formatarMoeda(p.descontoCentavos)}` : ""}${p.taxaOriginalCentavos > 0 && p.taxaEntregaCentavos === 0 ? " · frete grátis" : ""}` }) : "",
    criar("p", { texto: `Entrega: ${formatarMoeda(p.taxaEntregaCentavos)} · Total: ${formatarMoeda(p.totalCentavos)}` }),
    criar("p", { texto: `💳 ${FORMAS[pagamento.forma] || "—"}${troco}` }),
    p.status === STATUS_PEDIDO.CANCELADO && p.motivoCancelamento
      ? criar("p", { class: "pedido-motivo", texto: `Motivo do cancelamento: ${p.motivoCancelamento}` }) : "",
    criar("div", { class: "pedido-acoes" },
      ...(proximo ? [
        criar("button", { class: "btn", type: "button", texto: proximo.rotulo, "data-pedido": p.id, "data-status": proximo.status }),
        criar("button", { class: "btn btn-perigo", type: "button", texto: "Cancelar", "data-pedido": p.id, "data-status": STATUS_PEDIDO.CANCELADO })
      ] : []),
      criar("button", { class: "btn btn-secundario", type: "button", texto: "🖨️ Imprimir", "data-imprimir": "1" }))
  );
}

// ---------- Em andamento (ao vivo) ----------
function desenhar() {
  // O mais antigo primeiro (quem pediu antes é atendido antes)
  const ativos = pedidos.slice().sort((a, b) => milissegundos(a) - milissegundos(b));
  const novos = ativos.filter((p) => p.status === STATUS_PEDIDO.NOVO).length;
  document.title = novos ? `(${novos}) Pedidos — Deu Fome` : "Pedidos — Deu Fome";

  const blocos = [criar("h2", { texto: `Em andamento (${ativos.length})` })];
  if (!ativos.length) blocos.push(criar("p", { class: "texto-suave", texto: "Nenhum pedido em andamento. Quando chegar um, ele aparece aqui." }));
  ativos.forEach((p) => blocos.push(cartao(p)));
  lista.replaceChildren(...blocos);
}

function iniciarEscuta(restauranteId) {
  pararEscuta();
  const minha = escutaId;
  restauranteAtual = restauranteId;
  primeiraCarga = true;
  lista.replaceChildren(criar("p", { class: "texto-suave", texto: "Carregando pedidos..." }));
  $("#historicoArea").classList.remove("oculto");
  if (!$("#dataHistorico").value) $("#dataHistorico").value = hoje();
  $("#dataHistorico").max = hoje();
  carregarHistorico();

  cancelarEscuta = onSnapshot(
    query(collection(db, "restaurantes", restauranteId, "pedidos"), where("status", "in", EM_ANDAMENTO), limit(100)),
    (snapshot) => {
      if (minha !== escutaId) return;
      if (snapshot.metadata.fromCache && primeiraCarga) return; // espera os dados do servidor
      pedidos = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
      const mudancas = snapshot.docChanges();
      if (!primeiraCarga) {
        const chegaram = mudancas.filter((c) => c.type === "added");
        if (chegaram.length) {
          toast(`Novo pedido #${chegaram[0].doc.data().numero}!`, "sucesso", 6000);
          apitar();
        }
        // Um pedido saiu de "em andamento" (entregue/cancelado): atualiza o histórico de hoje
        if (mudancas.some((c) => c.type === "removed") && $("#dataHistorico").value === hoje()) carregarHistorico();
      }
      primeiraCarga = false;
      desenhar();
    },
    (erro) => {
      if (minha !== escutaId) return;
      lista.replaceChildren(criar("p", { class: "mensagem erro", texto: mensagemErroFirebase(erro) }));
    }
  );
  prepararAvisos(restauranteId);
}

// ---------- Histórico por dia ----------
async function carregarHistorico() {
  if (!restauranteAtual) return;
  const minha = ++historicoId;
  const restauranteId = restauranteAtual;
  const data = $("#dataHistorico").value || hoje();
  const inicio = new Date(`${data}T00:00:00-03:00`);
  if (Number.isNaN(inicio.getTime())) return;
  const fim = new Date(inicio.getTime() + 24 * 60 * 60 * 1000);
  $("#resumoHistorico").textContent = "Carregando...";
  try {
    const snapshot = await getDocs(query(
      collection(db, "restaurantes", restauranteId, "pedidos"),
      where("criadoEm", ">=", inicio), where("criadoEm", "<", fim),
      orderBy("criadoEm", "desc"), limit(200)));
    if (minha !== historicoId) return;
    const dia = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
    const encerrados = dia.filter((p) => !EM_ANDAMENTO.includes(p.status));
    const entregues = encerrados.filter((p) => p.status === STATUS_PEDIDO.ENTREGUE);
    const cancelados = encerrados.filter((p) => p.status === STATUS_PEDIDO.CANCELADO);
    const faturado = entregues.reduce((soma, p) => soma + (Number(p.totalCentavos) || 0), 0);
    const emAndamento = dia.length - encerrados.length;
    $("#resumoHistorico").textContent = dia.length
      ? `${entregues.length} entregue(s) · ${formatarMoeda(faturado)} · ${cancelados.length} cancelado(s)` +
        (emAndamento ? ` · ${emAndamento} ainda em andamento` : "") +
        (snapshot.size >= 200 ? " · mostrando os 200 mais recentes" : "")
      : "Nenhum pedido neste dia.";
    listaHistorico.replaceChildren(...encerrados.map(cartao));
  } catch (erro) {
    if (minha !== historicoId) return;
    $("#resumoHistorico").textContent = "";
    listaHistorico.replaceChildren(criar("p", { class: "mensagem erro", texto: mensagemErroFirebase(erro) }));
  }
}

// ---------- Avisos no celular (push) ----------
async function atualizarAvisos() {
  const area = $("#avisosArea");
  const texto = $("#estadoAvisos");
  const botao = $("#btnAvisos");
  area.classList.remove("oculto");
  if (!(await suportado())) {
    texto.textContent = "Este navegador não recebe avisos com o app fechado. No iPhone: abra este endereço no Safari, toque em Compartilhar › Adicionar à Tela de Início e abra o Deu Fome por lá.";
    botao.classList.add("oculto");
    return;
  }
  const estado = permissao();
  if (estado === "denied") {
    texto.textContent = "Os avisos estão bloqueados neste navegador. Libere as notificações deste site nas configurações do navegador e recarregue a página.";
    botao.classList.add("oculto");
  } else if (estado === "granted" && avisosAtivos) {
    texto.textContent = "🔔 Avisos ativados neste aparelho: o celular toca quando chegar pedido, mesmo com o app fechado.";
    botao.textContent = "Desativar avisos";
    botao.dataset.acao = "desativar";
    botao.classList.remove("oculto");
  } else {
    texto.textContent = "Ative os avisos para receber o pedido mesmo com o app fechado. Se você só deixar a página aberta, o celular pode suspender e você perde o pedido.";
    botao.textContent = "🔔 Ativar avisos de novos pedidos";
    botao.dataset.acao = "ativar";
    botao.classList.remove("oculto");
  }
}

async function prepararAvisos(restauranteId) {
  const minha = escutaId;
  avisosAtivos = false;
  try {
    if (await suportado() && permissao() === "granted") avisosAtivos = await sincronizar(restauranteId);
  } catch (erro) { avisosAtivos = false; }
  if (minha !== escutaId) return;
  atualizarAvisos();
}

$("#btnAvisos").addEventListener("click", (evento) => {
  const botao = evento.currentTarget;
  if (!restauranteAtual) return;
  executar(botao, async () => {
    if (botao.dataset.acao === "desativar") {
      await desativar(restauranteAtual);
      avisosAtivos = false;
      toast("Avisos desativados neste aparelho.", "info");
    } else {
      await ativar(restauranteAtual);
      avisosAtivos = true;
      toast("Avisos ativados!", "sucesso");
    }
    await atualizarAvisos();
  });
});

// ---------- Mudar status / cancelar ----------
// Quem muda o status é o SERVIDOR (/api/atualizar-status): ele atualiza o pedido, o acompanhamento público
// e o resumo diário na mesma transação. O navegador não grava mais nessas coleções (firestore.rules nega).
async function mudarStatus(restauranteId, pedidoId, status, motivo) {
  if (!auth.currentUser) throw new Error("Entre de novo no painel.");
  const token = await auth.currentUser.getIdToken();
  await chamarApi("/api/atualizar-status", { restauranteId, pedidoId, status, motivo }, token);
}

// Imprime só este pedido (o CSS de impressão esconde o resto da página). Funciona em impressora comum
// e em impressora térmica instalada no celular/computador.
function imprimirPedido(cartaoPedido) {
  cartaoPedido.classList.add("imprimir");
  document.body.classList.add("imprimindo");
  const limpar = () => {
    cartaoPedido.classList.remove("imprimir");
    document.body.classList.remove("imprimindo");
    window.removeEventListener("afterprint", limpar);
  };
  window.addEventListener("afterprint", limpar);
  window.print();
}

function aoClicarNosPedidos(evento) {
  const imprimir = evento.target.closest("button[data-imprimir]");
  if (imprimir) {
    imprimirPedido(imprimir.closest(".pedido-cartao"));
    return;
  }
  const botao = evento.target.closest("button[data-pedido]");
  if (!botao || !restauranteAtual) return;
  const { pedido, status } = botao.dataset;
  let motivo = "";
  if (status === STATUS_PEDIDO.CANCELADO) {
    const resposta = prompt("Cancelar este pedido? Essa ação não pode ser desfeita.\n\nMotivo (o cliente vai ver; pode deixar em branco):");
    if (resposta === null) return; // apertou Cancelar na janela
    motivo = resposta.replace(/\s+/g, " ").trim().slice(0, 120);
  }
  const restauranteId = restauranteAtual;
  executar(botao, () => mudarStatus(restauranteId, pedido, status, motivo));
}
lista.addEventListener("click", aoClicarNosPedidos);
listaHistorico.addEventListener("click", aoClicarNosPedidos);

$("#seletorRestaurante").addEventListener("change", (evento) => iniciarEscuta(evento.target.value));
$("#btnHistorico").addEventListener("click", carregarHistorico);
$("#dataHistorico").addEventListener("change", carregarHistorico);

onAuthStateChanged(auth, async (user) => {
  const minha = ++carga;
  pararEscuta();
  lista.replaceChildren();
  listaHistorico.replaceChildren();
  $("#semLogin").classList.toggle("oculto", !!user);
  $("#app").classList.toggle("oculto", !user);
  $("#semVinculo").classList.add("oculto");
  $("#seletorArea").classList.add("oculto");
  $("#avisosArea").classList.add("oculto");
  $("#historicoArea").classList.add("oculto");
  if (!user) return;

  try {
    const snapshot = await getDocs(collection(db, "usuarios", user.uid, "restaurantes"));
    if (minha !== carga) return;
    const vinculos = snapshot.docs.map((d) => ({ ...d.data(), id: d.id })).filter((v) => v.ativo !== false);
    if (!vinculos.length) {
      $("#semVinculo").classList.remove("oculto");
      return;
    }
    $("#seletorRestaurante").replaceChildren(...vinculos.map((v) => criar("option", { value: v.id, texto: v.nome || v.id })));
    $("#seletorArea").classList.toggle("oculto", vinculos.length < 2);
    iniciarEscuta(vinculos[0].id);
  } catch (erro) {
    if (minha !== carga) return;
    lista.replaceChildren(criar("p", { class: "mensagem erro", texto: mensagemErroFirebase(erro) }));
  }
});
