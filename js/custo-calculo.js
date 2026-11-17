// Deu Fome — cálculo de custo e margem dos produtos (funções puras, sem Firebase: dá para testar no Node).
// Usado por painel/custos.html (js/custos.js). O servidor NÃO recalcula: ele só copia o custo já salvo
// na receita do produto para dentro do pedido, no momento da venda (api/criar-pedido.js).
//
// UNIDADES: o restaurante escolhe como compra cada ingrediente (g, kg, ml, l ou unidade) e como usa na receita
// (qualquer unidade da mesma família: g/kg, ml/l, un). Tudo é guardado na unidade BASE (g, ml ou un).
//
// DINHEIRO: venda em centavos (inteiro). Custo em "micro" (1 real = 1.000.000; 1 centavo = 10.000), porque um
// grama de ingrediente custa frações de centavo (R$ 32,00/kg = R$ 0,032/g = 32.000 micro por grama).

export const MICRO_POR_REAL = 1000000;
export const MICRO_POR_CENTAVO = 10000;

export const UNIDADES = {
  g: { base: "g", fator: 1, rotulo: "g (grama)" },
  kg: { base: "g", fator: 1000, rotulo: "kg (quilo)" },
  ml: { base: "ml", fator: 1, rotulo: "ml (mililitro)" },
  l: { base: "ml", fator: 1000, rotulo: "l (litro)" },
  un: { base: "un", fator: 1, rotulo: "unidade" }
};
export const ROTULO_BASE = { g: "g", ml: "ml", un: "un" };

// Unidades que podem ser usadas na receita para um ingrediente de determinada base
export function unidadesDaBase(base) {
  return Object.keys(UNIDADES).filter((u) => UNIDADES[u].base === base);
}

// "12,50" | "R$ 12,50" | "12.50" | "1.250,50" | "1,250.50" | "0,032" -> número. Inválido/negativo/vazio -> null
export function lerDecimal(texto) {
  let s = String(texto ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s || !/^[\d.,]+$/.test(s)) return null;
  const virgula = s.lastIndexOf(",");
  const ponto = s.lastIndexOf(".");
  if (virgula >= 0 && ponto >= 0) {
    // os dois aparecem: o último é o separador decimal, o outro é de milhar
    const decimal = virgula > ponto ? "," : ".";
    const milhar = decimal === "," ? "." : ",";
    s = s.split(milhar).join("").replace(decimal, ".");
  } else if (virgula >= 0) {
    if ((s.match(/,/g) || []).length > 1) return null;
    s = s.replace(",", ".");
  } else if (ponto >= 0) {
    // "1.250" (3 dígitos depois do ponto) é milhar, como no Brasil; "1.5" e "0.032" são decimais
    // (número que começa com zero nunca é milhar). Para decimal com 3 casas, use vírgula: "1,250".
    if (/^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) s = s.split(".").join("");
    else if ((s.match(/\./g) || []).length > 1) return null;
  }
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// Reais (número) -> micro (inteiro)
export const microDeReais = (reais) => Math.round(reais * MICRO_POR_REAL);

// Preço por 1 unidade escolhida (em micro) -> custo por unidade BASE (por grama, ml ou unidade)
export function custoMicroPorBase(precoMicro, unidade) {
  const u = UNIDADES[unidade];
  if (!u) throw new Error("unidade inválida: " + unidade);
  return Math.round(precoMicro / u.fator);
}

// Quantidade digitada na unidade escolhida -> quantidade na unidade base
export function quantidadeEmBase(quantidade, unidade) {
  const u = UNIDADES[unidade];
  if (!u) throw new Error("unidade inválida: " + unidade);
  return quantidade * u.fator;
}

// Custo de uma linha da receita (micro, inteiro)
export const custoLinhaMicro = (quantidadeBase, custoPorBase) => Math.round(quantidadeBase * custoPorBase);

// Custo total da receita. itens: [{ ingredienteId, quantidadeBase }]; ingredientes: { id: { custoMicroPorBase, base } }.
// Ingrediente que sumiu ou de outra base (ex.: receita em g e ingrediente trocado para ml) entra em "problemas".
export function custoReceitaMicro(itens, ingredientes, extraMicro = 0) {
  let soma = 0;
  const problemas = [];
  for (const item of Array.isArray(itens) ? itens : []) {
    const ing = ingredientes[item.ingredienteId];
    if (!ing || !Number.isInteger(ing.custoMicroPorBase)) { problemas.push({ ingredienteId: item.ingredienteId, motivo: "sumiu" }); continue; }
    if (item.unidadeBase && ing.base && item.unidadeBase !== ing.base) { problemas.push({ ingredienteId: item.ingredienteId, motivo: "unidade" }); continue; }
    soma += custoLinhaMicro(Number(item.quantidadeBase) || 0, ing.custoMicroPorBase);
  }
  return { custoMicro: soma + (Number.isInteger(extraMicro) ? extraMicro : 0), problemas };
}

// Receitas (lista de { id, itens }) que usam o ingrediente: quem precisa ser recalculado quando o preço muda
export function receitasQueUsam(receitas, ingredienteId) {
  return receitas.filter((r) => Array.isArray(r.itens) && r.itens.some((i) => i.ingredienteId === ingredienteId));
}

// Lucro e margem de um produto: preço de venda (centavos) contra custo (micro).
// margemPercentual = lucro / preço * 100 (pode ser negativa se custa mais que vende).
export function margemDoProduto(precoCentavos, custoMicro) {
  const custoCentavos = custoMicro / MICRO_POR_CENTAVO;
  const lucroCentavos = precoCentavos - custoCentavos;
  return {
    custoCentavos,
    lucroCentavos,
    margemPercentual: precoCentavos > 0 ? (lucroCentavos / precoCentavos) * 100 : 0
  };
}

const moedaBR = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
// Micro -> "R$ 4,50" (arredonda para o centavo só na hora de mostrar)
export const formatarMicro = (micro) => moedaBR.format(micro / MICRO_POR_REAL);
// Micro -> até 4 casas, para preço de ingrediente ("R$ 0,0320")
export const formatarMicroPreciso = (micro) =>
  "R$ " + (micro / MICRO_POR_REAL).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 4 });
export const formatarPercentual = (pct) => `${pct.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
