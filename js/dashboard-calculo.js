// Deu Fome — soma os resumos diários para o dashboard (sem Firebase: dá para testar em Node).
const MICRO_POR_CENTAVO = 10000;
const n = (v) => (Number.isFinite(v) ? v : 0);

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
    pedidosComCusto: 0, receitaComCustoCentavos: 0, custoMicro: 0,
    porHora: {}, pagamentos: {}, cupons: {}, produtos: {}, porDia: []
  };
  for (const r of resumos) {
    for (const c of ["pedidos", "entregues", "cancelados", "canceladosCentavos", "faturamentoCentavos", "produtosCentavos",
      "taxaEntregaCentavos", "descontoCentavos", "descontoEntregaCentavos", "pedidosComCusto", "receitaComCustoCentavos", "custoMicro"]) t[c] += n(r[c]);
    somarMapa(t.porHora, r.porHora, (a, b) => n(a) + n(b));
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
  return t;
}
