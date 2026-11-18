// Deu Fome — SIMULADO de um dia de restaurante (Firestore falso em memória, sem emulador).
// Cria dezenas de pedidos de "clientes" diferentes, usa cupons, entrega, cancela, tenta fraudes e confere
// se os números do dashboard batem com uma conta feita à parte. Rodar: node --test tests/simulado.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { totalizar } from "../js/dashboard-calculo.js";

const require = createRequire(import.meta.url);
const { banco, chamar } = require("./_firebase-falso.cjs");
const criarPedido = require("../api/criar-pedido.js");
const atualizarStatus = require("../api/atualizar-status.js");
const cancelarPedido = require("../api/cancelar-pedido.js");
const validarCupom = require("../api/validar-cupom.js");
const { diaSP } = require("../api/_status-regras.js");

const R = "restaurantes/r1";
const chave = (n) => String(n).padStart(24, "b");

function semear() {
  banco.limpar();
  banco.gravar(R, { nome: "Lanchonete Teste", ativo: true, aberto: true, horarioAbertura: "00:00", horarioFechamento: "00:00", taxaEntregaCentavos: 500 });
  banco.gravar(`${R}/categorias/c`, { ativo: true, nome: "Lanches" });
  banco.gravar(`${R}/produtos/p1`, { nome: "X-Salada", precoCentavos: 1500, ativo: true, disponivel: true, categoriaId: "c" });
  banco.gravar(`${R}/produtos/p2`, { nome: "Suco", precoCentavos: 600, ativo: true, disponivel: true, categoriaId: "c" });
  banco.gravar(`${R}/membros/dono`, { ativo: true });
  banco.gravar(`${R}/cupons/BEMVINDO10`, { tipo: "percentual", valor: 10, ativo: true, usos: 0, limiteUsos: 3, minimoCentavos: 0 });
  banco.gravar(`${R}/cupons/FRETE`, { tipo: "frete_gratis", ativo: true, usos: 0 });
}

const pedir = (n, itens, extra = {}, pagamento = "pix") => chamar(criarPedido, {
  ip: `10.1.${n}.1`, token: `cli${n}`,
  corpo: {
    restauranteId: "r1", chave: chave(n), itens,
    cliente: { nome: `Cliente ${n}`, telefone: `(49) 98${String(1000000 + n)}` },
    entrega: { endereco: `Rua ${n}, 1`, referencia: "" }, observacao: "", pagamento: { forma: pagamento }, ...extra
  }
});
const mudar = (id, st) => chamar(atualizarStatus, { token: "dono", corpo: { restauranteId: "r1", pedidoId: id, status: st } });

test("dia completo: números do dashboard batem com a conta feita à mão", async () => {
  semear();
  const esperado = { faturamento: 0, entregues: 0, cancelados: 0, desconto: 0 };
  const ids = [];

  // 12 clientes: pedido de 1 X-Salada + 1 Suco (2100 + taxa 500 = 2600), os 3 primeiros com BEMVINDO10 (limite 3)
  for (let n = 1; n <= 12; n++) {
    const cupom = n <= 3 ? "BEMVINDO10" : undefined;
    const itens = [{ produtoId: "p1", quantidade: 1 }, { produtoId: "p2", quantidade: 1 }];
    // O cliente confere o total antes: sem cupom 2600; com 10% -> desconto 210 -> 2390
    const total = cupom ? 2390 : 2600;
    const r = await pedir(n, itens, { totalEsperadoCentavos: total, ...(cupom ? { cupom } : {}) }, n % 2 ? "pix" : "dinheiro");
    assert.equal(r.codigo, 201, `pedido ${n}: ${JSON.stringify(r.corpo)}`);
    ids.push({ n, id: r.corpo.pedidoId, total });
  }

  // 4º cliente tenta o cupom depois do limite: recusado
  const estourado = await pedir(13, [{ produtoId: "p1", quantidade: 1 }], { totalEsperadoCentavos: 1850, cupom: "BEMVINDO10" });
  assert.equal(estourado.codigo, 409);
  assert.equal(estourado.corpo.codigo, "cupom_invalido");

  // Fraude: preço adulterado no navegador
  const fraude = await pedir(14, [{ produtoId: "p1", quantidade: 1 }], { totalEsperadoCentavos: 1 });
  assert.equal(fraude.codigo, 409);

  // 9 entregues, 3 cancelados (um deles com cupom: o uso volta)
  for (const { n, id, total } of ids) {
    if (n <= 9) {
      for (const st of ["preparando", "saiu_para_entrega", "entregue"]) assert.equal((await mudar(id, st)).codigo, 200);
      esperado.entregues++; esperado.faturamento += total; if (n <= 3) esperado.desconto += 210;
    } else if (n === 10) {
      assert.equal((await mudar(id, "cancelado")).codigo, 200); esperado.cancelados++;
    } else if (n === 11) {
      const c = await chamar(cancelarPedido, { corpo: { restauranteId: "r1", pedidoId: id, chave: chave(n) } });
      assert.equal(c.codigo, 200, JSON.stringify(c.corpo)); esperado.cancelados++;
    } else {
      await mudar(id, "preparando");
      assert.equal((await mudar(id, "cancelado")).codigo, 200); esperado.cancelados++;
    }
  }
  assert.equal(banco.ler(`${R}/cupons/BEMVINDO10`).usos, 3); // 3 usados e entregues, nenhum cancelado tinha cupom

  const hoje = diaSP(new Date());
  const t = totalizar([{ ...banco.ler(`${R}/resumos/${hoje}`), id: hoje }]);
  assert.equal(t.pedidos, 12);
  assert.equal(t.entregues, esperado.entregues);
  assert.equal(t.cancelados, esperado.cancelados);
  assert.equal(t.faturamentoCentavos, esperado.faturamento);
  assert.equal(t.descontoCentavos, esperado.desconto);
  assert.equal(t.ticketMedioCentavos, Math.round(esperado.faturamento / esperado.entregues));
  assert.equal(t.pagamentos.pix + t.pagamentos.dinheiro, 9);
  assert.equal(t.cupons.BEMVINDO10, 3);
  assert.equal(t.produtos.p1.quantidade, 9);
  assert.equal(t.maisVendidos.length, 2);
});

test("ataque: mesmo telefone pedindo em sequência é barrado; pedido com restaurante fechado é recusado", async () => {
  semear();
  const itens = [{ produtoId: "p2", quantidade: 1 }];
  let barrado = 0;
  for (let n = 1; n <= 8; n++) {
    const r = await chamar(criarPedido, { ip: `10.2.${n}.1`, token: `troll${n}`, corpo: {
      restauranteId: "r1", chave: chave(100 + n), itens, cliente: { nome: "Troll", telefone: "(49) 90000-0000" },
      entrega: { endereco: "Rua X, 1", referencia: "" }, observacao: "", pagamento: { forma: "pix" }, totalEsperadoCentavos: 1100 } });
    if (r.codigo === 429) barrado++;
  }
  assert.ok(barrado >= 3, `esperava bloqueio por telefone, bloqueou ${barrado}`);

  banco.gravar(R, { aberto: false }, true);
  const fechado = await chamar(criarPedido, { ip: "10.3.3.3", token: "ana", corpo: {
    restauranteId: "r1", chave: chave(200), itens, cliente: { nome: "Ana", telefone: "(49) 98888-7777" },
    entrega: { endereco: "Rua Y, 2", referencia: "" }, observacao: "", pagamento: { forma: "pix" }, totalEsperadoCentavos: 1100 } });
  assert.ok(fechado.codigo >= 400 && fechado.codigo < 500);
});

test("ataque: adivinhar cupons é barrado depois de 20 tentativas por IP", async () => {
  semear();
  let ultimo = 0;
  for (let i = 0; i < 25; i++) {
    const r = await chamar(validarCupom, { ip: "9.9.9.9", corpo: { restauranteId: "r1", codigo: `CHUTE${i}`, itens: [{ produtoId: "p1", quantidade: 1 }] } });
    ultimo = r.codigo;
  }
  assert.equal(ultimo, 429);
});

test("restaurante não mexe em pedido de outro restaurante", async () => {
  semear();
  banco.gravar("restaurantes/r2", { nome: "Outro", ativo: true, aberto: true, horarioAbertura: "00:00", horarioFechamento: "00:00", taxaEntregaCentavos: 0 });
  const r = await pedir(1, [{ produtoId: "p1", quantidade: 1 }], { totalEsperadoCentavos: 2000 });
  assert.equal(r.codigo, 201);
  const invasor = await chamar(atualizarStatus, { token: "estranho", corpo: { restauranteId: "r1", pedidoId: r.corpo.pedidoId, status: "preparando" } });
  assert.ok([401, 403].includes(invasor.codigo), `código ${invasor.codigo}`);
  assert.equal(banco.ler(`${R}/pedidos/${r.corpo.pedidoId}`).status, "novo");
});
