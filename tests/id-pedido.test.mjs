// Deu Fome — testes do código público do pedido (api/_id-pedido.js). Rodar: node --test tests/id-pedido.test.mjs
// Não precisa de emulador nem de dependências.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { derivarIdPedido } = createRequire(import.meta.url)("../api/_id-pedido.js");
const PEDIDO_ID_RE = /^[A-Za-z0-9]{20,40}$/; // mesmo formato aceito por cancelar-pedido e pelas telas

test("mesma chave no mesmo restaurante dá sempre o mesmo código (reenvio não duplica)", () => {
  assert.equal(derivarIdPedido("segredo", "restA", "chave1chave1chave1chave1"),
    derivarIdPedido("segredo", "restA", "chave1chave1chave1chave1"));
});

test("o código tem formato válido e não revela a chave", () => {
  const chave = "chave1chave1chave1chave1";
  const id = derivarIdPedido("segredo", "restA", chave);
  assert.match(id, PEDIDO_ID_RE);
  assert.ok(!id.includes(chave));
});

test("restaurante, chave ou segredo diferentes dão códigos diferentes", () => {
  const base = derivarIdPedido("segredo", "restA", "chave1chave1chave1chave1");
  assert.notEqual(base, derivarIdPedido("segredo", "restB", "chave1chave1chave1chave1"));
  assert.notEqual(base, derivarIdPedido("segredo", "restA", "chave2chave2chave2chave2"));
  assert.notEqual(base, derivarIdPedido("outroSegredo", "restA", "chave1chave1chave1chave1"));
});

test("sem segredo o servidor recusa gerar o código", () => {
  assert.throws(() => derivarIdPedido("", "restA", "chave1chave1chave1chave1"));
});
