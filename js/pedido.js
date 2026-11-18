// Deu Fome — acompanhamento do pedido pelo cliente, em tempo real. Endereço: /pedido?r=RESTAURANTE&p=PEDIDO
// O endereço do pedido tem um código aleatório: guarde o link para voltar a ele.
// Lê restaurantes/{r}/acompanhamento/{p}: versão pública do pedido, SEM telefone, endereço nem observação.
// (O pedido completo, em "pedidos", só o restaurante lê. Veja firestore.rules.)
import { db } from "./firebase-config.js";
// Cancelamento: o cliente cancela pelo servidor (/api/cancelar-pedido) usando o código secreto do pedido.
import { $, criar, formatarMoeda, formatarDataHora, ROTULO_STATUS, STATUS_PEDIDO, mensagemErroFirebase, chamarApi, executar, toast } from "./utils.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const conteudo = $("#conteudo");
let restauranteIdAtual = "";
let pedidoIdAtual = "";

const ETAPAS = [
  [STATUS_PEDIDO.NOVO, "Pedido recebido"],
  [STATUS_PEDIDO.PREPARANDO, "Em preparo"],
  [STATUS_PEDIDO.SAIU, "Saiu para entrega"],
  [STATUS_PEDIDO.ENTREGUE, "Entregue"]
];

const DESCRICAO = {
  novo: "Pedido enviado! Aguardando o restaurante confirmar.",
  preparando: "O restaurante está preparando o seu pedido.",
  saiu_para_entrega: "Seu pedido saiu para entrega. Fique de olho no telefone.",
  entregue: "Pedido entregue. Bom apetite!",
  cancelado: "Este pedido foi cancelado. Se precisar, fale com o restaurante."
};

const FORMAS = { dinheiro: "Dinheiro na entrega", cartao: "Cartão na entrega (maquininha)", pix: "Pix na entrega" };

function aviso(texto) {
  conteudo.replaceChildren(
    criar("p", { class: "mensagem erro card", texto }),
    criar("a", { class: "btn btn-secundario btn-bloco", href: "/", texto: "Ver restaurantes" })
  );
}

function linha(rotulo, valor, classe = "") {
  return criar("div", { class: `resumo-linha ${classe}`.trim() },
    criar("span", { texto: rotulo }), criar("span", { texto: valor }));
}

function desenhar(p) {
  const status = p.status;
  const cancelado = status === STATUS_PEDIDO.CANCELADO;
  const indice = ETAPAS.findIndex((e) => e[0] === status);
  document.title = `Pedido #${p.numero} — Deu Fome`;

  const topo = criar("section", { class: "card status-pedido" },
    criar("p", { class: "sobretitulo-cliente", texto: `${p.restauranteNome || "Restaurante"} · Pedido #${p.numero}` }),
    criar("p", { class: "status-grande", texto: ROTULO_STATUS[status] || status }),
    criar("p", { class: "texto-suave", texto: DESCRICAO[status] || "" }));
  if (cancelado && p.motivoCancelamento) {
    topo.append(criar("p", { class: "pedido-motivo", texto: `Motivo: ${p.motivoCancelamento}` }));
  } else if (p.cancelamentoSolicitado === true && status === STATUS_PEDIDO.PREPARANDO) {
    // Só faz sentido enquanto o restaurante ainda não respondeu (depois que sai para entrega, o pedido segue)
    topo.append(criar("p", { class: "texto-suave", texto: "Você pediu o cancelamento. O restaurante vai responder em breve." }));
  }
  if (!cancelado) {
    topo.append(criar("ol", { class: "etapas" },
      ...ETAPAS.map(([, rotulo], i) => criar("li", {
        class: "etapa" + (i < indice ? " feita" : i === indice ? " atual" : ""), texto: rotulo
      }))));
  }

  const itens = Array.isArray(p.itens) ? p.itens : [];
  const resumo = criar("section", { class: "card" },
    criar("h2", { texto: "Seu pedido" }),
    ...itens.map((i) => linha(`${i.quantidade}× ${i.nome}`, formatarMoeda(i.subtotalCentavos))),
    linha("Subtotal", formatarMoeda(p.subtotalCentavos)));
  // Cupom: pedidos antigos não têm esses campos, então só aparece quando existe
  if (p.descontoCentavos > 0) {
    resumo.append(linha(p.cupomCodigo ? `Desconto (${p.cupomCodigo})` : "Desconto", `− ${formatarMoeda(p.descontoCentavos)}`));
  }
  resumo.append(
    linha("Entrega", p.taxaEntregaCentavos > 0 ? formatarMoeda(p.taxaEntregaCentavos) : (p.taxaOriginalCentavos > 0 && p.cupomCodigo ? `Grátis (${p.cupomCodigo})` : "Grátis")),
    linha("Total", formatarMoeda(p.totalCentavos), "total"));

  // Telefone, endereço e observação ficam só no pedido completo (privado). Aqui só o primeiro nome.
  const pagamento = p.pagamento || {};
  const detalhes = criar("section", { class: "card" },
    criar("h2", { texto: "Detalhes" }),
    linha("Pagamento", FORMAS[pagamento.forma] || "—"));
  if (pagamento.forma === "dinheiro" && pagamento.trocoParaCentavos) {
    detalhes.append(linha("Troco para", formatarMoeda(pagamento.trocoParaCentavos)));
  }
  if (p.primeiroNome) detalhes.append(linha("Entregar para", p.primeiroNome));
  detalhes.append(linha("Enviado em", formatarDataHora(p.criadoEm)));

  const blocos = [topo, resumo, detalhes];

  // Cancelar: "novo" cancela na hora; "preparando" só pede (o restaurante decide); depois disso não oferece
  const podeCancelar = status === STATUS_PEDIDO.NOVO
    || (status === STATUS_PEDIDO.PREPARANDO && p.cancelamentoSolicitado !== true);
  if (podeCancelar) {
    blocos.push(criar("button", {
      class: "btn btn-perigo btn-bloco", type: "button",
      "data-cancelar": status === STATUS_PEDIDO.NOVO ? "cancelar" : "pedir", // "pedir": o restaurante decide
      texto: status === STATUS_PEDIDO.NOVO ? "Cancelar pedido" : "Pedir cancelamento"
    }));
  }

  blocos.push(
    criar("p", { class: "texto-suave centro", texto: "Guarde o endereço desta página (adicione aos favoritos) para acompanhar o pedido." }),
    criar("a", { class: "btn btn-secundario btn-bloco", href: "/meus-pedidos", texto: "Meus pedidos" }),
    criar("a", { class: "btn btn-secundario btn-bloco", href: "/", texto: "Voltar ao início" })
  );
  conteudo.replaceChildren(...blocos);
}

// Clique em "Cancelar pedido" / "Pedir cancelamento" (a tela é redesenhada a cada mudança, por isso delegamos)
conteudo.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-cancelar]");
  if (!botao || !restauranteIdAtual || !pedidoIdAtual) return;
  const pedirApenas = botao.dataset.cancelar === "pedir";
  const pergunta = pedirApenas
    ? "O restaurante já está preparando o pedido. Quer pedir o cancelamento? Ele decide se consegue cancelar."
    : "Cancelar este pedido? Essa ação não pode ser desfeita.";
  if (!confirm(pergunta)) return;
  executar(botao, async () => {
    const r = await chamarApi("/api/cancelar-pedido", { restauranteId: restauranteIdAtual, pedidoId: pedidoIdAtual });
    if (r.resultado === "cancelado") toast("Pedido cancelado.", "sucesso");
    else if (r.resultado === "solicitado") toast("Pedido de cancelamento enviado ao restaurante.", "sucesso");
    else toast("O cancelamento já tinha sido pedido.", "info");
  });
});

function iniciar() {
  const params = new URLSearchParams(location.search);
  const restauranteId = params.get("r") || "";
  const pedidoId = params.get("p") || "";
  if (!/^[A-Za-z0-9]{1,64}$/.test(restauranteId) || !/^[A-Za-z0-9]{20,40}$/.test(pedidoId)) {
    return aviso("Pedido não encontrado. Confira o endereço.");
  }
  restauranteIdAtual = restauranteId;
  pedidoIdAtual = pedidoId;
  const cancelar = onSnapshot(
    doc(db, "restaurantes", restauranteId, "acompanhamento", pedidoId),
    (snapshot) => {
      if (!snapshot.exists()) return aviso("Pedido não encontrado. Confira o endereço.");
      desenhar(snapshot.data());
    },
    (erro) => {
      if (erro && (erro.code === "permission-denied" || erro.code === "not-found")) return aviso("Pedido não encontrado. Confira o endereço.");
      aviso(mensagemErroFirebase(erro));
    }
  );
  window.addEventListener("pagehide", cancelar);
}

iniciar();
