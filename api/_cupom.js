// Deu Fome — regras de cupom de desconto (puras, sem Firebase: dá para testar no Node).
// O nome começa com "_" para a Vercel NÃO expor este arquivo como endereço.
//
// Cupom: restaurantes/{id}/cupons/{CODIGO}. Só o restaurante lê e grava (firestore.rules);
// o cliente valida o código pela API (/api/validar-cupom) e o pedido (/api/criar-pedido) valida DE NOVO
// e soma o uso dentro da mesma transação, então o limite de usos não estoura nem com pedidos simultâneos.
//
// Tipos (o restaurante escolhe; o padrão do painel é percentual):
//   percentual   — desconto de X% sobre os produtos (1 a 100). Arredonda para baixo, em centavos.
//   fixo         — desconto de R$ X sobre os produtos (nunca passa do valor dos produtos).
//   frete_gratis — zera a taxa de entrega.
// O desconto nunca incide sobre a taxa de entrega (só o frete grátis mexe nela).

const TIPOS = ["percentual", "fixo", "frete_gratis"];

// "primeira compra" / "Primeira-Compra" -> "PRIMEIRACOMPRA". Só letras e números, 3 a 20. Inválido -> null
function normalizarCodigo(texto) {
  const codigo = String(texto == null ? "" : texto).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z0-9]{3,20}$/.test(codigo) ? codigo : null;
}

// Timestamp do Firestore, Date, número (ms) ou nada -> milissegundos (ou null)
function milis(valor) {
  if (valor == null) return null;
  if (typeof valor.toMillis === "function") return valor.toMillis();
  if (valor instanceof Date) return valor.getTime();
  return Number.isFinite(valor) ? valor : null;
}

const reais = (centavos) => "R$ " + (centavos / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Confere o cupom contra o pedido. cupom: dados do documento (ou null se não existe).
// Devolve { ok: true, descontoCentavos, taxaFinalCentavos, descontoEntregaCentavos, totalCentavos, cupom }
//      ou { ok: false, motivo }.
function avaliarCupom(cupom, { subtotalCentavos, taxaCentavos, agora }) {
  // Cupom inexistente ou desativado têm a mesma resposta: não revela quais códigos existem
  if (!cupom || cupom.ativo !== true || !TIPOS.includes(cupom.tipo)) return { ok: false, motivo: "Cupom inválido." };

  const ate = milis(cupom.validadeAte);
  if (ate !== null && agora > ate) return { ok: false, motivo: "Este cupom está vencido." };

  const usos = Number(cupom.usos) || 0;
  if (Number.isInteger(cupom.limiteUsos) && usos >= cupom.limiteUsos) {
    return { ok: false, motivo: "Este cupom já atingiu o limite de usos." };
  }

  const minimo = Number.isInteger(cupom.minimoCentavos) ? cupom.minimoCentavos : 0;
  if (subtotalCentavos < minimo) {
    return { ok: false, motivo: `Este cupom vale para pedidos a partir de ${reais(minimo)} em produtos.` };
  }

  let desconto = 0;
  let taxaFinal = taxaCentavos;
  if (cupom.tipo === "percentual") {
    if (!Number.isInteger(cupom.valor) || cupom.valor < 1 || cupom.valor > 100) return { ok: false, motivo: "Cupom inválido." };
    desconto = Math.floor((subtotalCentavos * cupom.valor) / 100);
  } else if (cupom.tipo === "fixo") {
    if (!Number.isInteger(cupom.valor) || cupom.valor < 1) return { ok: false, motivo: "Cupom inválido." };
    desconto = Math.min(cupom.valor, subtotalCentavos);
  } else {
    taxaFinal = 0;
  }

  return {
    ok: true,
    descontoCentavos: desconto,
    taxaFinalCentavos: taxaFinal,
    descontoEntregaCentavos: taxaCentavos - taxaFinal,
    totalCentavos: subtotalCentavos - desconto + taxaFinal,
    cupom: { codigo: String(cupom.codigo || ""), tipo: cupom.tipo, valor: cupom.valor }
  };
}

module.exports = { TIPOS, normalizarCodigo, avaliarCupom, milis };
