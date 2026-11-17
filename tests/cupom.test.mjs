// Deu Fome — testes das regras puras de cupom (api/_cupom.js). Rodar: node --test tests/cupom.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { normalizarCodigo, avaliarCupom } = createRequire(import.meta.url)("../api/_cupom.js");

const base = { codigo: "PROMO10", tipo: "percentual", valor: 10, ativo: true, usos: 0 };
const avaliar = (cupom, extra = {}) =>
  avaliarCupom(cupom, { subtotalCentavos: 3600, taxaCentavos: 500, agora: Date.now(), ...extra });

test("código: maiúsculas, sem espaço nem símbolo, de 3 a 20 caracteres", () => {
  assert.equal(normalizarCodigo(" primeira-compra "), "PRIMEIRACOMPRA");
  assert.equal(normalizarCodigo("promo10"), "PROMO10");
  assert.equal(normalizarCodigo("ab"), null);
  assert.equal(normalizarCodigo("a".repeat(21)), null);
  assert.equal(normalizarCodigo(""), null);
  assert.equal(normalizarCodigo(null), null);
  assert.equal(normalizarCodigo("../../x"), null); // vira "X", curto demais: nada de caminho de arquivo
});

test("percentual: arredonda o desconto para baixo e não mexe na taxa de entrega", () => {
  const r = avaliar(base);
  assert.equal(r.ok, true);
  assert.equal(r.descontoCentavos, 360);
  assert.equal(r.taxaFinalCentavos, 500);
  assert.equal(r.totalCentavos, 3740);
  assert.equal(avaliar(base, { subtotalCentavos: 999 }).descontoCentavos, 99); // 99,9 -> 99
});

test("percentual 100% zera os produtos mas continua cobrando a entrega", () => {
  const r = avaliar({ ...base, valor: 100 });
  assert.equal(r.descontoCentavos, 3600);
  assert.equal(r.totalCentavos, 500);
});

test("fixo: nunca passa do valor dos produtos", () => {
  assert.equal(avaliar({ ...base, tipo: "fixo", valor: 1000 }).descontoCentavos, 1000);
  const r = avaliar({ ...base, tipo: "fixo", valor: 9000 });
  assert.equal(r.descontoCentavos, 3600);
  assert.equal(r.totalCentavos, 500);
});

test("frete grátis: zera a taxa e informa quanto deixou de cobrar", () => {
  const r = avaliar({ ...base, tipo: "frete_gratis", valor: 0 });
  assert.equal(r.descontoCentavos, 0);
  assert.equal(r.taxaFinalCentavos, 0);
  assert.equal(r.descontoEntregaCentavos, 500);
  assert.equal(r.totalCentavos, 3600);
});

test("cupom inexistente, desativado ou de tipo desconhecido: mesma resposta, sem revelar nada", () => {
  for (const c of [null, undefined, { ...base, ativo: false }, { ...base, tipo: "mistério" }]) {
    const r = avaliar(c);
    assert.equal(r.ok, false);
    assert.equal(r.motivo, "Cupom inválido.");
  }
});

test("validade: aceita Timestamp, Date e número; vencido é recusado", () => {
  const agora = Date.now();
  const ts = (ms) => ({ toMillis: () => ms });
  assert.equal(avaliar({ ...base, validadeAte: ts(agora + 60000) }).ok, true);
  assert.equal(avaliar({ ...base, validadeAte: new Date(agora + 60000) }).ok, true);
  assert.equal(avaliar({ ...base, validadeAte: agora + 60000 }).ok, true);
  assert.equal(avaliar({ ...base, validadeAte: null }).ok, true);
  const vencido = avaliar({ ...base, validadeAte: ts(agora - 1) });
  assert.equal(vencido.ok, false);
  assert.match(vencido.motivo, /vencido/);
});

test("limite de usos: o último uso passa, o seguinte não", () => {
  assert.equal(avaliar({ ...base, limiteUsos: 3, usos: 2 }).ok, true);
  const r = avaliar({ ...base, limiteUsos: 3, usos: 3 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /limite/);
  assert.equal(avaliar({ ...base, limiteUsos: null, usos: 9999 }).ok, true); // sem limite
});

test("pedido mínimo vale sobre os produtos (sem a taxa de entrega)", () => {
  assert.equal(avaliar({ ...base, minimoCentavos: 3600 }).ok, true);
  const r = avaliar({ ...base, minimoCentavos: 3601 });
  assert.equal(r.ok, false);
  assert.match(r.motivo, /R\$ 36,01/);
});

test("valor corrompido no cupom é recusado em vez de gerar desconto estranho", () => {
  assert.equal(avaliar({ ...base, valor: 150 }).ok, false);
  assert.equal(avaliar({ ...base, valor: -5 }).ok, false);
  assert.equal(avaliar({ ...base, valor: "10" }).ok, false);
  assert.equal(avaliar({ ...base, tipo: "fixo", valor: 0 }).ok, false);
});
