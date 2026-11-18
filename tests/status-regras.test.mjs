// Deu Fome — testes das regras puras do pedido e do resumo diário (api/_status-regras.js).
// Rodar: node --test tests/status-regras.test.mjs   (sem emulador, sem dependências)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const R = createRequire(import.meta.url)("../api/_status-regras.js");

test("transições válidas do pedido", () => {
  const ok = [["novo", "preparando"], ["novo", "cancelado"], ["preparando", "saiu_para_entrega"],
    ["preparando", "cancelado"], ["saiu_para_entrega", "entregue"], ["saiu_para_entrega", "cancelado"]];
  ok.forEach(([de, para]) => assert.equal(R.transicaoValida(de, para), true, `${de} > ${para}`));
});

test("transições inválidas: pular etapa, voltar, sair de estado final", () => {
  const ruim = [["novo", "entregue"], ["novo", "saiu_para_entrega"], ["preparando", "novo"], ["preparando", "entregue"],
    ["entregue", "cancelado"], ["entregue", "novo"], ["cancelado", "preparando"], ["novo", "novo"], ["x", "novo"], [undefined, "novo"]];
  ruim.forEach(([de, para]) => assert.equal(R.transicaoValida(de, para), false, `${de} > ${para}`));
});

test("dia e hora no fuso de Brasília (UTC-3), inclusive na virada do dia", () => {
  assert.equal(R.diaSP(new Date("2026-11-17T02:30:00Z")), "2026-11-16"); // 23:30 do dia 16 em Brasília
  assert.equal(R.horaSP(new Date("2026-11-17T02:30:00Z")), "23");
  assert.equal(R.diaSP(new Date("2026-11-17T03:00:00Z")), "2026-11-17"); // 00:00 do dia 17
  assert.equal(R.horaSP(new Date("2026-11-17T03:00:00Z")), "00");
  assert.equal(R.horaSP(new Date("2026-11-17T21:05:00Z")), "18");
});

const pedido = {
  totalCentavos: 4100, subtotalCentavos: 3600, taxaEntregaCentavos: 500, descontoCentavos: 0,
  pagamento: { forma: "pix" },
  itens: [
    { produtoId: "p1", nome: "X-Salada", quantidade: 2, subtotalCentavos: 3000 },
    { produtoId: "p2", nome: "Suco", quantidade: 1, subtotalCentavos: 600 }
  ]
};

test("criado soma 1 pedido e a hora", () => {
  assert.deepEqual(R.deltaResumo(pedido, { tipo: "criado", data: new Date("2026-11-17T21:05:00Z") }),
    { pedidos: 1, porHora: { "18": 1 }, porDiaSemana: { ter: 1 } });
});

test("dia da semana no fuso de Brasília (sexta 23:30 em Brasília ainda é sexta, mesmo sendo sábado em UTC)", () => {
  assert.equal(R.diaSemanaSP(new Date("2026-11-21T02:30:00Z")), "sex"); // sex 20/11 23:30 em Brasília
  assert.equal(R.diaSemanaSP(new Date("2026-11-21T03:00:00Z")), "sab"); // 00:00 de sábado
  assert.equal(R.diaSemanaSP(new Date("2026-11-22T15:00:00Z")), "dom");
});

test("cancelado soma o cancelamento e o valor perdido", () => {
  assert.deepEqual(R.deltaResumo(pedido, { tipo: "status", para: "cancelado" }), { cancelados: 1, canceladosCentavos: 4100 });
});

test("entregue soma faturamento, produtos, pagamento (sem custo conhecido não entra na margem)", () => {
  const d = R.deltaResumo(pedido, { tipo: "status", para: "entregue" });
  assert.equal(d.entregues, 1);
  assert.equal(d.faturamentoCentavos, 4100);
  assert.equal(d.produtosCentavos, 3600);
  assert.equal(d.taxaEntregaCentavos, 500);
  assert.deepEqual(d.pagamentos, { pix: 1 });
  assert.deepEqual(d.produtos.p1, { nome: "X-Salada", quantidade: 2, receitaCentavos: 3000 });
  assert.equal(d.pedidosComCusto, undefined);
  assert.equal(d.custoMicro, undefined);
});

test("entregue com custo conhecido em TODOS os itens entra na margem", () => {
  const comCusto = { ...pedido, itens: pedido.itens.map((i, n) => ({ ...i, custoUnitarioMicro: n === 0 ? 4500000 : 1200000 })) };
  const d = R.deltaResumo(comCusto, { tipo: "status", para: "entregue" });
  assert.equal(d.pedidosComCusto, 1);
  assert.equal(d.receitaComCustoCentavos, 3600);
  assert.equal(d.custoMicro, 2 * 4500000 + 1200000);
});

test("custo parcial (um item sem custo) NÃO entra na margem", () => {
  const parcial = { ...pedido, itens: [{ ...pedido.itens[0], custoUnitarioMicro: 4500000 }, pedido.itens[1]] };
  const d = R.deltaResumo(parcial, { tipo: "status", para: "entregue" });
  assert.equal(d.pedidosComCusto, undefined);
  assert.equal(R.custoCompletoMicro(parcial), null);
});

test("desconto reduz a venda de produtos mas não o valor bruto dos itens", () => {
  const d = R.deltaResumo({ ...pedido, descontoCentavos: 360, totalCentavos: 3740 }, { tipo: "status", para: "entregue" });
  assert.equal(d.produtosCentavos, 3240);
  assert.equal(d.descontoCentavos, 360);
  assert.equal(d.faturamentoCentavos, 3740);
});

test("eventos que não contam no resumo", () => {
  assert.equal(R.deltaResumo(pedido, { tipo: "status", para: "preparando" }), null);
  assert.equal(R.deltaResumo(pedido, { tipo: "outro" }), null);
});

test("paraIncrementos troca só os números, em qualquer nível", () => {
  const r = R.paraIncrementos({ a: 1, b: { c: 2, nome: "x" }, d: "texto" }, (n) => `inc(${n})`);
  assert.deepEqual(r, { a: "inc(1)", b: { c: "inc(2)", nome: "x" }, d: "texto" });
});

test("entregue soma as combinações de produtos diferentes do mesmo pedido", () => {
  const d = R.deltaResumo(pedido, { tipo: "status", para: "entregue" });
  assert.deepEqual(d.combos, { p1_p2: { nomes: "X-Salada + Suco", qtd: 1 } });
  // um produto só não forma combinação
  const um = R.deltaResumo({ ...pedido, itens: [pedido.itens[0]] }, { tipo: "status", para: "entregue" });
  assert.equal(um.combos, undefined);
});

test("combinações: no máximo 8 produtos por pedido (28 pares) e a chave não depende da ordem dos itens", () => {
  const itens = Array.from({ length: 12 }, (_, i) => ({ produtoId: `p${String(i).padStart(2, "0")}`, nome: `P${i}`, quantidade: 1, subtotalCentavos: 100 }));
  const d = R.deltaResumo({ ...pedido, itens }, { tipo: "status", para: "entregue" });
  assert.equal(Object.keys(d.combos).length, 28);
  const invertido = R.deltaResumo({ ...pedido, itens: [...pedido.itens].reverse() }, { tipo: "status", para: "entregue" });
  assert.deepEqual(Object.keys(invertido.combos), ["p1_p2"]);
});

test("perfil do cliente só entra com consentimento e só com valores válidos", () => {
  const analise = { bairro: "Centro", bairroChave: "centro", faixaEtaria: "25a34", comoConheceu: "instagram" };
  const com = R.deltaResumo({ ...pedido, consentimentoAnalise: true, analise }, { tipo: "status", para: "entregue" });
  assert.equal(com.pedidosComAnalise, 1);
  assert.deepEqual(com.bairros, { centro: { nome: "Centro", qtd: 1 } });
  assert.deepEqual(com.faixasEtarias, { "25a34": 1 });
  assert.deepEqual(com.comoConheceu, { instagram: 1 });

  // sem consentimento gravado: ignora mesmo que haja dados no pedido
  const sem = R.deltaResumo({ ...pedido, consentimentoAnalise: false, analise }, { tipo: "status", para: "entregue" });
  assert.equal(sem.pedidosComAnalise, undefined);
  assert.equal(sem.bairros, undefined);

  // valores fora da lista (inclusive menor de idade) e chave de bairro estranha são descartados
  const ruim = R.deltaResumo({ ...pedido, consentimentoAnalise: true,
    analise: { bairro: "X", bairroChave: "a.b/c", faixaEtaria: "ate17", comoConheceu: "hack" } }, { tipo: "status", para: "entregue" });
  assert.equal(ruim.pedidosComAnalise, 1);
  assert.equal(ruim.bairros, undefined);
  assert.equal(ruim.faixasEtarias, undefined);
  assert.equal(ruim.comoConheceu, undefined);
});
