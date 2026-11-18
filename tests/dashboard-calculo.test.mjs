import test from "node:test";
import assert from "node:assert/strict";
import { totalizar, intervalo } from "../js/dashboard-calculo.js";

test("soma dias, ticket médio e margem", () => {
  const t = totalizar([
    { id: "2026-11-02", pedidos: 3, entregues: 2, cancelados: 1, canceladosCentavos: 3000, faturamentoCentavos: 10000, pedidosComCusto: 2,
      receitaComCustoCentavos: 9000, custoMicro: 30000000, porHora: { "19": 2, "20": 1 }, pagamentos: { pix: 2 },
      produtos: { a: { nome: "X", quantidade: 3, receitaCentavos: 9000 } }, cupons: { OI10: 1 } },
    { id: "2026-11-01", pedidos: 1, entregues: 1, faturamentoCentavos: 5000, porHora: { "19": 1 }, pagamentos: { dinheiro: 1 },
      produtos: { a: { nome: "X", quantidade: 1, receitaCentavos: 3000 }, b: { nome: "Y", quantidade: 5, receitaCentavos: 1000 } } }
  ]);
  assert.equal(t.pedidos, 4);
  assert.equal(t.ticketMedioCentavos, 5000);
  assert.equal(t.custoCentavos, 3000);
  assert.equal(t.lucroCentavos, 6000);
  assert.equal(t.margemPercentual, 66.7);
  assert.equal(t.coberturaCusto, 67);
  assert.equal(t.maisVendidos[0].nome, "Y");
  assert.equal(t.produtos.a.quantidade, 4);
  assert.equal(t.porHora["19"], 3);
  assert.equal(t.porDia[0].dia, "2026-11-01");
  assert.equal(t.cupons.OI10, 1);
});
test("vazio não quebra", () => {
  const t = totalizar([]);
  assert.equal(t.ticketMedioCentavos, 0);
  assert.equal(t.margemPercentual, null);
});
test("intervalo de 7 dias", () => {
  const { inicio, fim } = intervalo(7, new Date("2026-11-17T15:00:00Z"));
  assert.equal(fim, "2026-11-17");
  assert.equal(inicio, "2026-11-11");
});

test("perfil dos clientes, dias da semana e combinações somam entre os dias", () => {
  const t = totalizar([
    { id: "2026-11-02", pedidos: 3, entregues: 2, pedidosComAnalise: 2, porDiaSemana: { seg: 2, ter: 1 },
      bairros: { centro: { nome: "Centro", qtd: 2 } }, faixasEtarias: { "25a34": 1, "18a24": 1 }, comoConheceu: { instagram: 2 },
      combos: { a_b: { nomes: "X + Suco", qtd: 2 } } },
    { id: "2026-11-03", pedidos: 2, entregues: 2, pedidosComAnalise: 1, porDiaSemana: { seg: 1, dom: 1 },
      bairros: { centro: { nome: "Centro", qtd: 1 }, sao_jose: { nome: "São José", qtd: 4 } }, faixasEtarias: { "25a34": 1 },
      comoConheceu: { indicacao: 4, instagram: 1 }, combos: { a_b: { nomes: "X + Suco", qtd: 1 }, a_c: { nomes: "X + Batata", qtd: 5 } } }
  ]);
  assert.equal(t.pedidosComAnalise, 3);
  assert.deepEqual(t.diasSemana.map((d) => d.dia), ["seg", "ter", "qua", "qui", "sex", "sab", "dom"]);
  assert.equal(t.diasSemana.find((d) => d.dia === "seg").qtd, 3);
  assert.equal(t.diasSemana.find((d) => d.dia === "qua").qtd, 0);
  assert.deepEqual(t.topBairros, [{ nome: "São José", qtd: 4 }, { nome: "Centro", qtd: 3 }]);
  assert.deepEqual(t.faixas, [{ faixa: "18a24", qtd: 1 }, { faixa: "25a34", qtd: 2 }]); // na ordem das idades
  assert.deepEqual(t.origens, [{ origem: "indicacao", qtd: 4 }, { origem: "instagram", qtd: 3 }]);
  assert.deepEqual(t.topCombos[0], { nomes: "X + Batata", qtd: 5 });
  assert.equal(t.topCombos[1].qtd, 3);
});

test("resumos antigos (sem os campos novos) continuam funcionando", () => {
  const t = totalizar([{ id: "2026-10-01", pedidos: 1, entregues: 1, faturamentoCentavos: 2000, porHora: { "12": 1 } }]);
  assert.equal(t.pedidosComAnalise, 0);
  assert.deepEqual(t.topBairros, []);
  assert.deepEqual(t.topCombos, []);
  assert.deepEqual(t.faixas, []);
  assert.equal(t.diasSemana.every((d) => d.qtd === 0), true);
});
