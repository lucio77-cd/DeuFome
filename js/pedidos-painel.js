// Deu Fome — pedidos recebidos pelo restaurante, em tempo real (Etapa 3)
// A tela só mostra/esconde; quem protege os dados é o firestore.rules.
import { auth, db } from "./firebase-config.js";
import { $, criar, formatarMoeda, formatarDataHora, formatarTelefone, ROTULO_STATUS, STATUS_PEDIDO, executar, mensagemErroFirebase, toast } from "./utils.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const lista = $("#lista");

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
let cancelarEscuta = null;
let restauranteAtual = "";
let pedidos = [];
let primeiraCarga = true;

function pararEscuta() {
  escutaId++;
  if (cancelarEscuta) cancelarEscuta();
  cancelarEscuta = null;
  restauranteAtual = "";
  pedidos = [];
}

function apitar() {
  try {
    const Contexto = window.AudioContext || window.webkitAudioContext;
    if (!Contexto) return;
    const audio = new Contexto();
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

  return criar("article", { class: "card pedido-cartao" + (p.status === STATUS_PEDIDO.NOVO ? " pedido-novo" : "") },
    criar("div", { class: "pedido-cabecalho" },
      criar("strong", { texto: `Pedido #${p.numero ?? "?"}` }),
      criar("span", { class: `selo ${SELO[p.status] || ""}`.trim(), texto: ROTULO_STATUS[p.status] || p.status })),
    criar("small", { class: "texto-suave", texto: formatarDataHora(p.criadoEm) }),
    criar("p", {},
      criar("strong", { texto: cliente.nome || "Cliente" }), " · ",
      criar("a", { href: `tel:${telefone}`, texto: formatarTelefone(telefone) }), " · ",
      criar("a", { href: `https://wa.me/55${telefone}`, target: "_blank", rel: "noopener", texto: "WhatsApp" })),
    criar("p", { texto: `📍 ${entrega.endereco || ""}${entrega.referencia ? ` — ${entrega.referencia}` : ""}` }),
    criar("ul", { class: "pedido-itens" },
      ...itens.map((i) => criar("li", { texto: `${i.quantidade}× ${i.nome} — ${formatarMoeda(i.subtotalCentavos)}` }))),
    p.observacao ? criar("p", { class: "mensagem aviso", texto: `Obs.: ${p.observacao}` }) : "",
    criar("p", { texto: `Entrega: ${formatarMoeda(p.taxaEntregaCentavos)} · Total: ${formatarMoeda(p.totalCentavos)}` }),
    criar("p", { texto: `💳 ${FORMAS[pagamento.forma] || "—"}${troco}` }),
    proximo
      ? criar("div", { class: "pedido-acoes" },
        criar("button", { class: "btn", type: "button", texto: proximo.rotulo, "data-pedido": p.id, "data-status": proximo.status }),
        criar("button", { class: "btn btn-perigo", type: "button", texto: "Cancelar", "data-pedido": p.id, "data-status": STATUS_PEDIDO.CANCELADO }))
      : ""
  );
}

function desenhar() {
  // Em andamento: o mais antigo primeiro (quem pediu antes é atendido antes). Encerrados: os mais recentes primeiro.
  const ativos = pedidos.filter((p) => EM_ANDAMENTO.includes(p.status)).sort((a, b) => milissegundos(a) - milissegundos(b));
  const encerrados = pedidos.filter((p) => !EM_ANDAMENTO.includes(p.status));
  const novos = ativos.filter((p) => p.status === STATUS_PEDIDO.NOVO).length;
  document.title = novos ? `(${novos}) Pedidos — Deu Fome` : "Pedidos — Deu Fome";

  const blocos = [criar("h2", { texto: `Em andamento (${ativos.length})` })];
  if (!ativos.length) blocos.push(criar("p", { class: "texto-suave", texto: "Nenhum pedido em andamento. Quando chegar um, ele aparece aqui." }));
  ativos.forEach((p) => blocos.push(cartao(p)));
  if (encerrados.length) {
    blocos.push(criar("h2", { texto: "Encerrados (mais recentes)" }));
    encerrados.forEach((p) => blocos.push(cartao(p)));
  }
  lista.replaceChildren(...blocos);
}

function iniciarEscuta(restauranteId) {
  pararEscuta();
  const minha = escutaId;
  restauranteAtual = restauranteId;
  primeiraCarga = true;
  lista.replaceChildren(criar("p", { class: "texto-suave", texto: "Carregando pedidos..." }));

  cancelarEscuta = onSnapshot(
    query(collection(db, "restaurantes", restauranteId, "pedidos"), orderBy("criadoEm", "desc"), limit(80)),
    (snapshot) => {
      if (minha !== escutaId) return;
      if (snapshot.metadata.fromCache && primeiraCarga) return; // espera os dados do servidor
      pedidos = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
      if (!primeiraCarga) {
        const chegaram = snapshot.docChanges().filter((c) => c.type === "added");
        if (chegaram.length) {
          toast(`Novo pedido #${chegaram[0].doc.data().numero}!`, "sucesso", 6000);
          apitar();
        }
      }
      primeiraCarga = false;
      desenhar();
    },
    (erro) => {
      if (minha !== escutaId) return;
      lista.replaceChildren(criar("p", { class: "mensagem erro", texto: mensagemErroFirebase(erro) }));
    }
  );
}

// Botões: avançar status ou cancelar
lista.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-pedido]");
  if (!botao || !restauranteAtual) return;
  const { pedido, status } = botao.dataset;
  if (status === STATUS_PEDIDO.CANCELADO && !confirm("Cancelar este pedido? Essa ação não pode ser desfeita.")) return;
  executar(botao, async () => {
    await updateDoc(doc(db, "restaurantes", restauranteAtual, "pedidos", pedido), {
      status, atualizadoEm: serverTimestamp()
    });
  });
});

$("#seletorRestaurante").addEventListener("change", (evento) => iniciarEscuta(evento.target.value));

onAuthStateChanged(auth, async (user) => {
  const minha = ++carga;
  pararEscuta();
  lista.replaceChildren();
  $("#semLogin").classList.toggle("oculto", !!user);
  $("#app").classList.toggle("oculto", !user);
  $("#semVinculo").classList.add("oculto");
  $("#seletorArea").classList.add("oculto");
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
