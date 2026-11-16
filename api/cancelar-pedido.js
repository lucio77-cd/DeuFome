// Deu Fome — POST /api/cancelar-pedido (função serverless da Vercel)
// O cliente (sem conta) cancela o próprio pedido usando o código secreto do pedido.
//   status "novo"       -> cancela na hora
//   status "preparando" -> só registra o PEDIDO de cancelamento (o restaurante decide)
//   depois disso        -> recusa

const { FieldValue } = require("firebase-admin/firestore");
const { ErroPedido, iniciarFirebase, lerCorpo, origemDe, enviarAviso, emSegundoPlano } = require("./_comum");

const ID_RE = /^[A-Za-z0-9]{1,64}$/;
const PEDIDO_ID_RE = /^[A-Za-z0-9]{20,40}$/;

async function cancelar(db, corpo) {
  const restauranteId = String(corpo.restauranteId || "");
  const pedidoId = String(corpo.pedidoId || "");
  if (!ID_RE.test(restauranteId) || !PEDIDO_ID_RE.test(pedidoId)) throw new ErroPedido(400, "Pedido inválido.");

  const restRef = db.collection("restaurantes").doc(restauranteId);
  const pedidoRef = restRef.collection("pedidos").doc(pedidoId);
  const acompRef = restRef.collection("acompanhamento").doc(pedidoId);

  return db.runTransaction(async (t) => {
    const [pedidoSnap, acompSnap] = await t.getAll(pedidoRef, acompRef);
    if (!pedidoSnap.exists) throw new ErroPedido(404, "Pedido não encontrado.");
    const pedido = pedidoSnap.data();
    const base = { atualizadoEm: FieldValue.serverTimestamp() };

    let dados;
    let resultado;
    if (pedido.status === "novo") {
      dados = { ...base, status: "cancelado", motivoCancelamento: "Cancelado pelo cliente", canceladoPor: "cliente" };
      resultado = { resultado: "cancelado", numero: pedido.numero };
    } else if (pedido.status === "preparando") {
      if (pedido.cancelamentoSolicitado === true) return { resultado: "ja_solicitado", numero: pedido.numero };
      dados = { ...base, cancelamentoSolicitado: true };
      resultado = { resultado: "solicitado", numero: pedido.numero };
    } else if (pedido.status === "cancelado") {
      throw new ErroPedido(409, "Este pedido já está cancelado.");
    } else {
      throw new ErroPedido(409, "Este pedido não pode mais ser cancelado por aqui. Fale com o restaurante.");
    }

    t.update(pedidoRef, dados);
    if (acompSnap.exists) t.update(acompRef, dados); // pedidos antigos podem não ter o acompanhamento
    return resultado;
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
    const corpo = lerCorpo(req);
    const resultado = await cancelar(db, corpo);
    if (resultado.resultado === "cancelado") {
      await emSegundoPlano(enviarAviso(db, String(corpo.restauranteId), `Pedido #${resultado.numero} cancelado`,
        "O cliente cancelou o pedido.", origemDe(req)));
    } else if (resultado.resultado === "solicitado") {
      await emSegundoPlano(enviarAviso(db, String(corpo.restauranteId), `Pedido #${resultado.numero}: cancelamento pedido`,
        "O cliente quer cancelar. Abra o painel para decidir.", origemDe(req)));
    }
    return res.status(200).json({ ok: true, ...resultado });
  } catch (erro) {
    if (erro instanceof ErroPedido) {
      return res.status(erro.status).json({ erro: erro.message, ...erro.extra });
    }
    console.error("cancelar-pedido:", erro);
    return res.status(500).json({ erro: "Não foi possível cancelar o pedido. Tente novamente." });
  }
};
