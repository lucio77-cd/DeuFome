// Deu Fome — POST /api/validar-cupom (função serverless da Vercel)
// O cliente digita o código no carrinho e esta função diz se vale, quanto desconta e o novo total.
// É só uma PRÉVIA: quem decide de verdade é /api/criar-pedido, que valida o cupom de novo e soma o uso
// dentro da transação do pedido. O desconto é sempre calculado aqui no servidor, com preços do Firestore.
//
// Corpo: { restauranteId, codigo, itens: [{ produtoId, quantidade }] }
// Resposta 200: { ok, codigo, tipo, valor, subtotalCentavos, descontoCentavos, taxaCentavos, totalCentavos }
// Erros: 400 (dados), 409 { codigo: "cupom_invalido" | "produto_indisponivel" }, 429 (muitas tentativas)

const { ErroPedido, iniciarFirebase, hash, limitarPorJanela, ipDoCliente, lerCorpo } = require("./_comum");
const { normalizarCodigo, avaliarCupom } = require("./_cupom");

const ID_RE = /^[A-Za-z0-9]{1,64}$/;
const JANELA_MS = 10 * 60 * 1000;
const MAX_CONFERENCIAS_IP = 20; // por IP, a cada 10 minutos: impede adivinhar códigos
const MAX_POR_ITEM = 20;

async function validar(db, corpo, ip) {
  const restauranteId = String(corpo.restauranteId || "");
  if (!ID_RE.test(restauranteId)) throw new ErroPedido(400, "Restaurante inválido.");
  const codigo = normalizarCodigo(corpo.codigo);
  if (!codigo) throw new ErroPedido(409, "Cupom inválido.", { codigo: "cupom_invalido" });

  if (!Array.isArray(corpo.itens) || corpo.itens.length < 1 || corpo.itens.length > 40) {
    throw new ErroPedido(400, "O carrinho está vazio ou grande demais.");
  }
  const quantidades = new Map();
  for (const item of corpo.itens) {
    const produtoId = String((item && item.produtoId) || "");
    const quantidade = item && item.quantidade;
    if (!ID_RE.test(produtoId) || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_POR_ITEM) {
      throw new ErroPedido(400, "Item inválido no carrinho.");
    }
    quantidades.set(produtoId, (quantidades.get(produtoId) || 0) + quantidade);
  }

  await limitarPorJanela(db, "cup_" + hash(ip), MAX_CONFERENCIAS_IP, JANELA_MS,
    "Muitas tentativas de cupom. Aguarde alguns minutos e tente de novo.");

  const restRef = db.collection("restaurantes").doc(restauranteId);
  const produtoRefs = [...quantidades.keys()].map((id) => restRef.collection("produtos").doc(id));
  const [restSnap, cupomSnap, ...produtoSnaps] = await Promise.all([
    restRef.get(), restRef.collection("cupons").doc(codigo).get(), ...produtoRefs.map((r) => r.get())
  ]);
  if (!restSnap.exists || restSnap.data().ativo !== true) {
    throw new ErroPedido(404, "Restaurante não encontrado ou indisponível.");
  }
  const rest = restSnap.data();

  let subtotal = 0;
  const naoDisponiveis = [];
  produtoSnaps.forEach((snap, i) => {
    const p = snap.exists ? snap.data() : null;
    if (!p || p.ativo !== true || p.disponivel !== true || !Number.isInteger(p.precoCentavos) || p.precoCentavos <= 0) {
      naoDisponiveis.push(produtoRefs[i].id);
      return;
    }
    subtotal += p.precoCentavos * quantidades.get(produtoRefs[i].id);
  });
  if (naoDisponiveis.length) {
    throw new ErroPedido(409, "Alguns itens não estão mais disponíveis.", { codigo: "produto_indisponivel", produtoIds: naoDisponiveis });
  }

  const taxa = Number.isInteger(rest.taxaEntregaCentavos) ? rest.taxaEntregaCentavos : 0;
  const av = avaliarCupom(cupomSnap.exists ? cupomSnap.data() : null, { subtotalCentavos: subtotal, taxaCentavos: taxa, agora: Date.now() });
  if (!av.ok) throw new ErroPedido(409, av.motivo, { codigo: "cupom_invalido" });

  return {
    codigo, tipo: av.cupom.tipo, valor: av.cupom.valor,
    subtotalCentavos: subtotal, descontoCentavos: av.descontoCentavos,
    taxaCentavos: av.taxaFinalCentavos, totalCentavos: av.totalCentavos
  };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ erro: "Método não permitido." });
  }
  try {
    const db = iniciarFirebase();
    const resultado = await validar(db, lerCorpo(req), ipDoCliente(req));
    return res.status(200).json({ ok: true, ...resultado });
  } catch (erro) {
    if (erro instanceof ErroPedido) {
      return res.status(erro.status).json({ erro: erro.message, ...erro.extra });
    }
    console.error("validar-cupom:", erro);
    return res.status(500).json({ erro: "Não foi possível conferir o cupom. Tente novamente." });
  }
};
