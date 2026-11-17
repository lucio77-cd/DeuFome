// Deu Fome — regras puras do andamento do pedido e do resumo diário (sem Firebase: dá para testar sem emulador).
// O nome começa com "_" para a Vercel NÃO expor este arquivo como endereço.
//
// RESUMO DIÁRIO: restaurantes/{id}/resumos/{AAAA-MM-DD} guarda contadores já somados (pedidos, entregues,
// faturamento, produtos mais vendidos, horários...). O dashboard lê só esses documentos (poucos),
// em vez de baixar todos os pedidos. O dia é o dia em que o pedido foi CRIADO (fuso de Brasília), então
// tudo de um pedido cai no mesmo documento. Só o servidor grava, dentro da mesma transação do pedido.
//
// DINHEIRO: venda em centavos (inteiro). Custo em "micro" (1 real = 1.000.000; 1 centavo = 10.000),
// porque ingrediente custa frações de centavo (R$ 32/kg = 0,032 por grama).

const FUSO = "America/Sao_Paulo";
const MICRO_POR_CENTAVO = 10000;

const STATUS = ["novo", "preparando", "saiu_para_entrega", "entregue", "cancelado"];
const TRANSICOES = {
  novo: ["preparando", "cancelado"],
  preparando: ["saiu_para_entrega", "cancelado"],
  saiu_para_entrega: ["entregue", "cancelado"]
};

// Mesma regra de transicaoValida() do firestore.rules
function transicaoValida(de, para) {
  return Array.isArray(TRANSICOES[de]) && TRANSICOES[de].includes(para);
}

const formatoDia = new Intl.DateTimeFormat("sv-SE", { timeZone: FUSO });
const formatoHora = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO, hour: "2-digit", hourCycle: "h23" });

// "AAAA-MM-DD" no horário de Brasília
function diaSP(data) {
  return formatoDia.format(data);
}

// "00" a "23" no horário de Brasília
function horaSP(data) {
  const parte = formatoHora.formatToParts(data).find((p) => p.type === "hour");
  return String(Number(parte.value)).padStart(2, "0");
}

const inteiro = (n) => (Number.isFinite(n) ? Math.round(n) : 0);

// Custo do pedido, se TODOS os itens têm custo conhecido (senão null: não entra na margem)
function custoCompletoMicro(pedido) {
  const itens = Array.isArray(pedido.itens) ? pedido.itens : [];
  if (!itens.length) return null;
  let soma = 0;
  for (const i of itens) {
    if (!Number.isFinite(i.custoUnitarioMicro) || i.custoUnitarioMicro < 0) return null;
    soma += i.custoUnitarioMicro * (Number(i.quantidade) || 0);
  }
  return Math.round(soma);
}

// Quanto o evento soma no resumo do dia (só números e textos; o servidor troca números por increment()).
// evento: { tipo: "criado", data: Date } | { tipo: "status", para: "entregue" | "cancelado" }
function deltaResumo(pedido, evento) {
  if (evento.tipo === "criado") {
    return { pedidos: 1, porHora: { [horaSP(evento.data)]: 1 } };
  }
  if (evento.tipo !== "status") return null;

  const total = inteiro(pedido.totalCentavos);
  if (evento.para === "cancelado") {
    return { cancelados: 1, canceladosCentavos: total };
  }
  if (evento.para !== "entregue") return null;

  const desconto = inteiro(pedido.descontoCentavos);
  const produtosCentavos = inteiro(pedido.subtotalCentavos) - desconto; // venda sem a taxa de entrega
  const delta = {
    entregues: 1,
    faturamentoCentavos: total,
    produtosCentavos,
    taxaEntregaCentavos: inteiro(pedido.taxaEntregaCentavos),
    descontoCentavos: desconto,
    pagamentos: { [(pedido.pagamento && pedido.pagamento.forma) || "outro"]: 1 },
    produtos: {}
  };
  for (const i of Array.isArray(pedido.itens) ? pedido.itens : []) {
    if (!i || typeof i.produtoId !== "string") continue;
    const atual = delta.produtos[i.produtoId] || { nome: String(i.nome || ""), quantidade: 0, receitaCentavos: 0 };
    atual.quantidade += inteiro(i.quantidade);
    atual.receitaCentavos += inteiro(i.subtotalCentavos);
    delta.produtos[i.produtoId] = atual;
  }
  const custo = custoCompletoMicro(pedido);
  if (custo !== null) {
    delta.pedidosComCusto = 1;
    delta.receitaComCustoCentavos = produtosCentavos;
    delta.custoMicro = custo;
  }
  return delta;
}

// Troca cada número do objeto por increment(número) (função recebida, para não depender do Firebase aqui)
function paraIncrementos(objeto, incrementar) {
  const saida = {};
  for (const [chave, valor] of Object.entries(objeto)) {
    if (typeof valor === "number") saida[chave] = incrementar(valor);
    else if (valor && typeof valor === "object") saida[chave] = paraIncrementos(valor, incrementar);
    else saida[chave] = valor;
  }
  return saida;
}

module.exports = {
  FUSO, MICRO_POR_CENTAVO, STATUS, transicaoValida, diaSP, horaSP, custoCompletoMicro, deltaResumo, paraIncrementos
};
