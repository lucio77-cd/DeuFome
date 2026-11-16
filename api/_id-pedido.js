// Deu Fome — código público (secreto) do pedido, gerado pelo SERVIDOR.
// O cliente manda só uma "chave" de reenvio (para o pedido não duplicar se a rede falhar).
// O código que vira endereço de /pedido?p=... é derivado dessa chave com um segredo que só o servidor tem:
// - o mesmo reenvio gera o mesmo código (idempotência);
// - quem escolhe a chave não escolhe nem adivinha o código (nem o próprio, nem o de outra pessoa).
// O nome começa com "_" para a Vercel NÃO expor este arquivo como endereço.

const crypto = require("crypto");

// 32 caracteres hexadecimais (128 bits). Cabe em PEDIDO_ID_RE (/^[A-Za-z0-9]{20,40}$/).
function derivarIdPedido(segredo, restauranteId, chave) {
  if (!segredo) throw new Error("segredo ausente");
  return crypto
    .createHmac("sha256", segredo)
    .update(`pedido|${restauranteId}|${chave}`)
    .digest("hex")
    .slice(0, 32);
}

module.exports = { derivarIdPedido };
