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

// Dados de análise que o cliente pode informar (sempre opcionais, com aviso e consentimento).
// Faixa etária só a partir de 18 anos: o app não coleta idade de menores.
const FAIXAS_ETARIAS = ["18a24", "25a34", "35a44", "45a54", "55mais"];
const COMO_CONHECEU = ["indicacao", "instagram", "facebook", "google", "passou", "outro"];
const MAX_PRODUTOS_NAS_COMBINACOES = 8; // 8 produtos diferentes geram no máximo 28 pares por pedido

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

const DIAS_SEMANA = { Sun: "dom", Mon: "seg", Tue: "ter", Wed: "qua", Thu: "qui", Fri: "sex", Sat: "sab" };
const formatoSemana = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, weekday: "short" });

// "dom", "seg", "ter", "qua", "qui", "sex" ou "sab" no horário de Brasília
function diaSemanaSP(data) {
  return DIAS_SEMANA[formatoSemana.format(data)] || "seg";
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
    return { pedidos: 1, porHora: { [horaSP(evento.data)]: 1 }, porDiaSemana: { [diaSemanaSP(evento.data)]: 1 } };
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
  // Frete grátis: quanto de taxa o restaurante deixou de cobrar (taxaOriginal só existe em pedidos novos)
  if (Number.isFinite(pedido.taxaOriginalCentavos)) {
    delta.descontoEntregaCentavos = Math.max(0, inteiro(pedido.taxaOriginalCentavos) - inteiro(pedido.taxaEntregaCentavos));
  }
  // Quantas entregas usaram cada cupom (o código só tem letras e números, serve de chave do mapa)
  if (pedido.cupom && typeof pedido.cupom.codigo === "string" && /^[A-Z0-9]{3,20}$/.test(pedido.cupom.codigo)) {
    delta.cupons = { [pedido.cupom.codigo]: 1 };
  }
  for (const i of Array.isArray(pedido.itens) ? pedido.itens : []) {
    if (!i || typeof i.produtoId !== "string") continue;
    const atual = delta.produtos[i.produtoId] || { nome: String(i.nome || ""), quantidade: 0, receitaCentavos: 0 };
    atual.quantidade += inteiro(i.quantidade);
    atual.receitaCentavos += inteiro(i.subtotalCentavos);
    delta.produtos[i.produtoId] = atual;
  }
  // Combinações: quais produtos diferentes saem juntos no mesmo pedido (pares; a chave junta os dois códigos)
  const distintos = Object.entries(delta.produtos).slice(0, MAX_PRODUTOS_NAS_COMBINACOES)
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (let a = 0; a < distintos.length; a++) {
    for (let b = a + 1; b < distintos.length; b++) {
      delta.combos = delta.combos || {};
      delta.combos[`${distintos[a][0]}_${distintos[b][0]}`] = { nomes: `${distintos[a][1].nome} + ${distintos[b][1].nome}`, qtd: 1 };
    }
  }
  // Perfil do cliente: só entra se ele deu consentimento no pedido (campos opcionais)
  const analise = pedido.consentimentoAnalise === true && pedido.analise && typeof pedido.analise === "object" ? pedido.analise : null;
  if (analise) {
    delta.pedidosComAnalise = 1;
    if (typeof analise.bairroChave === "string" && /^[a-z0-9_]{1,30}$/.test(analise.bairroChave)) {
      delta.bairros = { [analise.bairroChave]: { nome: String(analise.bairro || "").slice(0, 40), qtd: 1 } };
    }
    if (FAIXAS_ETARIAS.includes(analise.faixaEtaria)) delta.faixasEtarias = { [analise.faixaEtaria]: 1 };
    if (COMO_CONHECEU.includes(analise.comoConheceu)) delta.comoConheceu = { [analise.comoConheceu]: 1 };
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
  FUSO, MICRO_POR_CENTAVO, STATUS, FAIXAS_ETARIAS, COMO_CONHECEU, transicaoValida, diaSP, horaSP, diaSemanaSP,
  custoCompletoMicro, deltaResumo, paraIncrementos
};
