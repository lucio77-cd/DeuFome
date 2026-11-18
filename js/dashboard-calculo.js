// Deu Fome — soma os resumos diários para o dashboard (sem Firebase: dá para testar em Node).
const MICRO_POR_CENTAVO = 10000;
const n = (v) => (Number.isFinite(v) ? v : 0);
const ORDEM_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
const ORDEM_FAIXAS = ["18a24", "25a34", "35a44", "45a54", "55mais"];

// Dias "AAAA-MM-DD" (horário de Brasília) de hoje voltando `dias` dias
export function diaSP(data) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(data);
}
export function intervalo(dias, hoje = new Date()) {
  const fim = diaSP(hoje);
  const inicio = diaSP(new Date(hoje.getTime() - (dias - 1) * 86400000));
  return { inicio, fim };
}

function somarMapa(destino, origem, soma) {
  for (const [k, v] of Object.entries(origem || {})) destino[k] = soma(destino[k], v);
}

// resumos: array de { id: "AAAA-MM-DD", ...contadores }
export function totalizar(resumos) {
  const t = {
    dias: resumos.length, pedidos: 0, entregues: 0, cancelados: 0, canceladosCentavos: 0,
    faturamentoCentavos: 0, produtosCentavos: 0, taxaEntregaCentavos: 0, descontoCentavos: 0, descontoEntregaCentavos: 0,
    pedidosComCusto: 0, receitaComCustoCentavos: 0, custoMicro: 0, pedidosComAnalise: 0,
    porHora: {}, porDiaSemana: {}, pagamentos: {}, cupons: {}, produtos: {}, bairros: {}, faixasEtarias: {}, comoConheceu: {},
    combos: {}, porDia: []
  };
  for (const r of resumos) {
    for (const c of ["pedidos", "entregues", "cancelados", "canceladosCentavos", "faturamentoCentavos", "produtosCentavos",
      "taxaEntregaCentavos", "descontoCentavos", "descontoEntregaCentavos", "pedidosComCusto", "receitaComCustoCentavos", "custoMicro",
      "pedidosComAnalise"]) t[c] += n(r[c]);
    somarMapa(t.porHora, r.porHora, (a, b) => n(a) + n(b));
    somarMapa(t.porDiaSemana, r.porDiaSemana, (a, b) => n(a) + n(b));
    somarMapa(t.faixasEtarias, r.faixasEtarias, (a, b) => n(a) + n(b));
    somarMapa(t.comoConheceu, r.comoConheceu, (a, b) => n(a) + n(b));
    somarMapa(t.bairros, r.bairros, (a, b) => ({ nome: (b && b.nome) || (a && a.nome) || "", qtd: n(a && a.qtd) + n(b && b.qtd) }));
    somarMapa(t.combos, r.combos, (a, b) => ({ nomes: (b && b.nomes) || (a && a.nomes) || "", qtd: n(a && a.qtd) + n(b && b.qtd) }));
    somarMapa(t.pagamentos, r.pagamentos, (a, b) => n(a) + n(b));
    somarMapa(t.cupons, r.cupons, (a, b) => n(a) + n(b));
    somarMapa(t.produtos, r.produtos, (a, b) => ({
      nome: (b && b.nome) || (a && a.nome) || "",
      quantidade: n(a && a.quantidade) + n(b && b.quantidade),
      receitaCentavos: n(a && a.receitaCentavos) + n(b && b.receitaCentavos)
    }));
    t.porDia.push({ dia: r.id, entregues: n(r.entregues), faturamentoCentavos: n(r.faturamentoCentavos) });
  }
  t.porDia.sort((a, b) => a.dia.localeCompare(b.dia));
  t.ticketMedioCentavos = t.entregues ? Math.round(t.faturamentoCentavos / t.entregues) : 0;
  // Margem só sobre pedidos com custo completo (senão o número mentiria)
  t.custoCentavos = Math.round(t.custoMicro / MICRO_POR_CENTAVO);
  t.lucroCentavos = t.receitaComCustoCentavos - t.custoCentavos;
  t.margemPercentual = t.receitaComCustoCentavos > 0 ? Math.round((t.lucroCentavos / t.receitaComCustoCentavos) * 1000) / 10 : null;
  t.coberturaCusto = t.entregues ? Math.round((t.pedidosComCusto / t.entregues) * 100) : null;
  t.maisVendidos = Object.values(t.produtos).sort((a, b) => b.quantidade - a.quantidade).slice(0, 10);
  t.horarios = Object.entries(t.porHora).map(([hora, qtd]) => ({ hora, qtd })).sort((a, b) => a.hora.localeCompare(b.hora));
  // Perfil dos clientes e combinações (contagens somadas; nada individual)
  t.diasSemana = ORDEM_SEMANA.map((dia) => ({ dia, qtd: n(t.porDiaSemana[dia]) }));
  t.faixas = ORDEM_FAIXAS.filter((f) => t.faixasEtarias[f]).map((faixa) => ({ faixa, qtd: t.faixasEtarias[faixa] }));
  t.origens = Object.entries(t.comoConheceu).map(([origem, qtd]) => ({ origem, qtd })).sort((a, b) => b.qtd - a.qtd);
  t.topBairros = Object.values(t.bairros).sort((a, b) => b.qtd - a.qtd).slice(0, 8);
  t.topCombos = Object.values(t.combos).sort((a, b) => b.qtd - a.qtd).slice(0, 8);
  return t;
}
