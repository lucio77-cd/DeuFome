// Deu Fome — acompanhamento do pedido pelo cliente, em tempo real. Endereço: /pedido?r=RESTAURANTE&p=PEDIDO
// O endereço do pedido tem um código aleatório: guarde o link para voltar a ele.
import { db } from "./firebase-config.js";
import { $, criar, formatarMoeda, formatarDataHora, formatarTelefone, ROTULO_STATUS, STATUS_PEDIDO, mensagemErroFirebase } from "./utils.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const conteudo = $("#conteudo");

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
    linha("Subtotal", formatarMoeda(p.subtotalCentavos)),
    linha("Entrega", p.taxaEntregaCentavos > 0 ? formatarMoeda(p.taxaEntregaCentavos) : "Grátis"),
    linha("Total", formatarMoeda(p.totalCentavos), "total"));

  const cliente = p.cliente || {};
  const entrega = p.entrega || {};
  const pagamento = p.pagamento || {};
  const detalhes = criar("section", { class: "card" },
    criar("h2", { texto: "Detalhes" }),
    linha("Pagamento", FORMAS[pagamento.forma] || "—"));
  if (pagamento.forma === "dinheiro" && pagamento.trocoParaCentavos) {
    detalhes.append(linha("Troco para", formatarMoeda(pagamento.trocoParaCentavos)));
  }
  detalhes.append(
    linha("Entregar para", `${cliente.nome || ""} · ${formatarTelefone(cliente.telefone)}`),
    linha("Endereço", entrega.endereco || "—"));
  if (entrega.referencia) detalhes.append(linha("Referência", entrega.referencia));
  if (p.observacao) detalhes.append(linha("Observação", p.observacao));
  detalhes.append(linha("Enviado em", formatarDataHora(p.criadoEm)));

  conteudo.replaceChildren(
    topo, resumo, detalhes,
    criar("p", { class: "texto-suave centro", texto: "Guarde o endereço desta página (adicione aos favoritos) para acompanhar o pedido." }),
    criar("a", { class: "btn btn-secundario btn-bloco", href: "/", texto: "Voltar ao início" })
  );
}

function iniciar() {
  const params = new URLSearchParams(location.search);
  const restauranteId = params.get("r") || "";
  const pedidoId = params.get("p") || "";
  if (!/^[A-Za-z0-9]{1,64}$/.test(restauranteId) || !/^[A-Za-z0-9]{20,40}$/.test(pedidoId)) {
    return aviso("Pedido não encontrado. Confira o endereço.");
  }
  const cancelar = onSnapshot(
    doc(db, "restaurantes", restauranteId, "pedidos", pedidoId),
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
