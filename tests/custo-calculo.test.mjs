// Deu Fome — testes do cálculo de custo e margem (js/custo-calculo.js). Rodar: node --test tests/custo-calculo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as C from "../js/custo-calculo.js";

test("lerDecimal entende formatos brasileiros e americanos", () => {
  const casos = [["12,50", 12.5], ["R$ 12,50", 12.5], ["12.50", 12.5], ["1.250,50", 1250.5], ["1,250.50", 1250.5],
    ["0,032", 0.032], ["0.032", 0.032], ["1.250", 1250], ["1.5", 1.5], ["500", 500], ["  7 ", 7], ["0", 0]];
  casos.forEach(([entrada, esperado]) => assert.equal(C.lerDecimal(entrada), esperado, `"${entrada}"`));
});

test("lerDecimal recusa lixo, negativo e vazio", () => {
  ["", "   ", "abc", "-5", "1,2,3", "1.2.3,4x", null, undefined, "12 reais"].forEach((x) =>
    assert.equal(C.lerDecimal(x), null, `"${x}"`));
});

test("preço por unidade escolhida vira custo por unidade base (todas as unidades)", () => {
  assert.equal(C.custoMicroPorBase(C.microDeReais(32), "kg"), 32000);   // R$ 32/kg = 0,032/g
  assert.equal(C.custoMicroPorBase(C.microDeReais(0.032), "g"), 32000); // mesmo valor digitado por grama
  assert.equal(C.custoMicroPorBase(C.microDeReais(5.8), "l"), 5800);    // R$ 5,80/l
  assert.equal(C.custoMicroPorBase(C.microDeReais(0.0058), "ml"), 5800);
  assert.equal(C.custoMicroPorBase(C.microDeReais(0.8), "un"), 800000); // ovo a R$ 0,80
  assert.throws(() => C.custoMicroPorBase(1, "xicara"));
});

test("quantidade digitada vira unidade base; unidades compatíveis por base", () => {
  assert.equal(C.quantidadeEmBase(1.5, "kg"), 1500);
  assert.equal(C.quantidadeEmBase(250, "g"), 250);
  assert.equal(C.quantidadeEmBase(0.2, "l"), 200);
  assert.equal(C.quantidadeEmBase(3, "un"), 3);
  assert.deepEqual(C.unidadesDaBase("g"), ["g", "kg"]);
  assert.deepEqual(C.unidadesDaBase("ml"), ["ml", "l"]);
  assert.deepEqual(C.unidadesDaBase("un"), ["un"]);
});

// Receita de exemplo: X-Salada = 120 g de carne (R$ 40/kg) + 30 g de queijo (R$ 50/kg) + 1 pão (R$ 0,90) + R$ 0,50 de embalagem
const ingredientes = {
  carne: { custoMicroPorBase: 40000, base: "g" },
  queijo: { custoMicroPorBase: 50000, base: "g" },
  pao: { custoMicroPorBase: 900000, base: "un" }
};
const receita = [
  { ingredienteId: "carne", quantidadeBase: 120, unidadeBase: "g" },
  { ingredienteId: "queijo", quantidadeBase: 30, unidadeBase: "g" },
  { ingredienteId: "pao", quantidadeBase: 1, unidadeBase: "un" }
];

test("custo da receita soma ingredientes e custo extra (embalagem)", () => {
  const { custoMicro, problemas } = C.custoReceitaMicro(receita, ingredientes, 500000);
  assert.deepEqual(problemas, []);
  assert.equal(custoMicro, 120 * 40000 + 30 * 50000 + 900000 + 500000); // R$ 7,70
  assert.equal(C.formatarMicro(custoMicro).replace(/\s/g, " "), "R$ 7,70");
});

test("subir o preço do queijo muda o custo novo (o pedido antigo guarda o custo da época)", () => {
  const antes = C.custoReceitaMicro(receita, ingredientes, 0).custoMicro;
  const queijoCaro = { ...ingredientes, queijo: { custoMicroPorBase: 80000, base: "g" } };
  const depois = C.custoReceitaMicro(receita, queijoCaro, 0).custoMicro;
  assert.equal(depois - antes, 30 * 30000); // 30 g × R$ 0,03 a mais por grama
  assert.equal(antes, 120 * 40000 + 30 * 50000 + 900000); // a conta antiga não foi alterada
});

test("ingrediente que sumiu ou trocou de unidade base vira problema (não zera em silêncio)", () => {
  const r1 = C.custoReceitaMicro(receita, { carne: ingredientes.carne, pao: ingredientes.pao }, 0);
  assert.deepEqual(r1.problemas, [{ ingredienteId: "queijo", motivo: "sumiu" }]);
  const r2 = C.custoReceitaMicro(receita, { ...ingredientes, carne: { custoMicroPorBase: 10, base: "ml" } }, 0);
  assert.deepEqual(r2.problemas, [{ ingredienteId: "carne", motivo: "unidade" }]);
});

test("receitasQueUsam acha quem precisa ser recalculado", () => {
  const receitas = [{ id: "p1", itens: receita }, { id: "p2", itens: [{ ingredienteId: "pao", quantidadeBase: 2 }] }, { id: "p3" }];
  assert.deepEqual(C.receitasQueUsam(receitas, "queijo").map((r) => r.id), ["p1"]);
  assert.deepEqual(C.receitasQueUsam(receitas, "pao").map((r) => r.id), ["p1", "p2"]);
  assert.deepEqual(C.receitasQueUsam(receitas, "nada"), []);
});

test("margem: lucro e percentual, inclusive prejuízo", () => {
  const ok = C.margemDoProduto(1500, 7700000); // vende R$ 15,00, custa R$ 7,70
  assert.equal(Math.round(ok.lucroCentavos), 730);
  assert.equal(Math.round(ok.margemPercentual * 10) / 10, 48.7);
  const prejuizo = C.margemDoProduto(500, 7700000);
  assert.ok(prejuizo.lucroCentavos < 0 && prejuizo.margemPercentual < 0);
  assert.equal(C.margemDoProduto(0, 100).margemPercentual, 0); // sem divisão por zero
});
