// Deu Fome — POST /api/atualizar-status (função serverless da Vercel)
// O restaurante (logado no painel) avança o pedido: novo > preparando > saiu_para_entrega > entregue,
// ou cancela com motivo. É a ÚNICA porta de mudança de status feita pelo restaurante: o navegador não
// grava mais em "pedidos" nem em "acompanhamento" (o firestore.rules nega), porque o resumo diário do
// dashboard só fica certo se toda mudança passar por aqui, dentro da mesma transação.
//
// Corpo: { restauranteId, pedidoId, status, motivo? }   Cabeçalho: Authorization: Bearer <token do login>

const { FieldValue } = require("firebase-admin/firestore");
const { ErroPedido, iniciarFirebase, usuarioDaRequisicao, exigirGestor, lerCorpo, texto } = require("./_comum");
const { STATUS, transicaoValida } = require("./_status-regras");
const { gravarResumo } = require("./_status");

const ID_RE = /^[A-Za-z0-9]{1,64}$/;
const PEDIDO_ID_RE = /^[A-Za-z0-9]{20,40}$/;

async function atualizar(db, uid, corpo) {
  const restauranteId = String(corpo.restauranteId || "");
  const pedidoId = String(corpo.pedidoId || "");
  const status = String(corpo.status || "");
  if (!ID_RE.test(restauranteId) || !PEDIDO_ID_RE.test(pedidoId)) throw new ErroPedido(400, "Pedido inválido.");
  if (!STATUS.includes(status)) throw new ErroPedido(400, "Status inválido.");
  const motivo = status === "cancelado" ? texto(corpo.motivo, "motivo", 0, 120) : "";

  await exigirGestor(db, uid, restauranteId);

  const restRef = db.collection("restaurantes").doc(restauranteId);
  const pedidoRef = restRef.collection("pedidos").doc(pedidoId);
  const acompRef = restRef.collection("acompanhamento").doc(pedidoId);

  return db.runTransaction(async (t) => {
    const [pedidoSnap, acompSnap] = await t.getAll(pedidoRef, acompRef);
    if (!pedidoSnap.exists) throw new ErroPedido(404, "Pedido não encontrado.");
    const pedido = pedidoSnap.data();

    // Duplo toque ou duas telas abertas: se já está no status pedido, não faz nada (e não soma duas vezes)
    if (pedido.status === status) return { status, numero: pedido.numero, jaEstava: true };
    if (!transicaoValida(pedido.status, status)) {
      throw new ErroPedido(409, "Este pedido já mudou de situação. Atualize a tela.", { statusAtual: pedido.status });
    }

    const dados = { status, atualizadoEm: FieldValue.serverTimestamp() };
    if (status === "cancelado") {
      if (motivo) dados.motivoCancelamento = motivo;
      dados.canceladoPor = "restaurante";
    }
    t.update(pedidoRef, dados);
    if (acompSnap.exists) t.update(acompRef, dados); // pedidos antigos podem não ter o acompanhamento
    if (status === "entregue" || status === "cancelado") {
      gravarResumo(t, restRef, pedido, { tipo: "status", para: status });
    }
    return { status, numero: pedido.numero, jaEstava: false };
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ erro: "Método não permitido." });
  }
  try {
    const db = iniciarFirebase();
    const uid = await usuarioDaRequisicao(req);
    const resultado = await atualizar(db, uid, lerCorpo(req));
    return res.status(200).json({ ok: true, ...resultado });
  } catch (erro) {
    if (erro instanceof ErroPedido) {
      return res.status(erro.status).json({ erro: erro.message, ...erro.extra });
    }
    console.error("atualizar-status:", erro);
    return res.status(500).json({ erro: "Não foi possível atualizar o pedido. Tente novamente." });
  }
};
