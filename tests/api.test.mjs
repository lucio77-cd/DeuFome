// Deu Fome — testes de integração das funções /api com um Firestore FALSO em memória (sem emulador).
// Conferem a lógica das transações: criar pedido, mudar status, cancelar e o resumo diário.
// NÃO conferem as regras de segurança do Firestore (isso é o regras.test.mjs, no emulador).
// Rodar: node --test tests/api.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { banco, chamar } = require("./_firebase-falso.cjs"); // ANTES de carregar as funções
const criarPedido = require("../api/criar-pedido.js");
const atualizarStatus = require("../api/atualizar-status.js");
const cancelarPedido = require("../api/cancelar-pedido.js");
const { MASTER_UID } = require("../api/_comum.js");
const { diaSP } = require("../api/_status-regras.js");

const R = "restaurantes/r1";

function semear() {
  banco.limpar();
  banco.gravar(R, { nome: "Lanchonete Teste", ativo: true, aberto: true, horarioAbertura: "00:00", horarioFechamento: "00:00", taxaEntregaCentavos: 500 });
  banco.gravar(`${R}/categorias/cat1`, { ativo: true, nome: "Lanches" });
  banco.gravar(`${R}/produtos/p1`, { nome: "X-Salada", precoCentavos: 1500, ativo: true, disponivel: true, categoriaId: "cat1" });
  banco.gravar(`${R}/produtos/p2`, { nome: "Suco", precoCentavos: 600, ativo: true, disponivel: true, categoriaId: "cat1" });
  banco.gravar(`${R}/membros/donoR1`, { ativo: true });
  banco.gravar("restaurantes/r2", { nome: "Outro", ativo: true, aberto: true, horarioAbertura: "00:00", horarioFechamento: "00:00", taxaEntregaCentavos: 0 });
  banco.gravar("restaurantes/r2/membros/donoR2", { ativo: true });
}
beforeEach(semear);

const chaveDe = (n) => String(n).padStart(24, "a");
const corpoPedido = (chave = chaveDe(1), extra = {}) => ({
  restauranteId: "r1", chave,
  itens: [{ produtoId: "p1", quantidade: 2 }, { produtoId: "p2", quantidade: 1 }],
  cliente: { nome: "Ana Silva", telefone: "(49) 99999-9999" },
  entrega: { endereco: "Rua A, 10", referencia: "" },
  observacao: "", pagamento: { forma: "pix" }, totalEsperadoCentavos: 4100, ...extra
});

async function novoPedido(n = 1) {
  const r = await chamar(criarPedido, { corpo: corpoPedido(chaveDe(n)), ip: `10.0.0.${n}` });
  assert.equal(r.codigo, 201, JSON.stringify(r.corpo));
  return r.corpo.pedidoId;
}
const status = (token, pedidoId, novo, motivo) =>
  chamar(atualizarStatus, { token, corpo: { restauranteId: "r1", pedidoId, status: novo, motivo } });
const resumo = () => banco.ler(`${R}/resumos/${diaSP(new Date())}`);
const pedidoDoc = (id) => banco.ler(`${R}/pedidos/${id}`);
const acompDoc = (id) => banco.ler(`${R}/acompanhamento/${id}`);

async function ate(pedidoId, ...passos) {
  for (const p of passos) {
    const r = await status("donoR1", pedidoId, p);
    assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  }
}

test("criar pedido: gera código de 32 caracteres, grava pedido, acompanhamento e conta no resumo", async () => {
  const id = await novoPedido();
  assert.match(id, /^[0-9a-f]{32}$/);
  const p = pedidoDoc(id);
  assert.equal(p.totalCentavos, 4100);
  assert.equal(p.resumoContado, true);
  assert.equal(p.resumoDia, diaSP(new Date()));
  assert.equal(acompDoc(id).primeiroNome, "Ana");
  assert.equal(acompDoc(id).cliente, undefined); // sem dados pessoais no documento público
  const r = resumo();
  assert.equal(r.pedidos, 1);
  assert.equal(Object.values(r.porHora).reduce((a, b) => a + b, 0), 1);
});

test("reenviar a mesma chave não duplica o pedido nem o resumo", async () => {
  const a = await chamar(criarPedido, { corpo: corpoPedido(chaveDe(1)), ip: "10.0.0.1" });
  const b = await chamar(criarPedido, { corpo: corpoPedido(chaveDe(1)), ip: "10.0.0.1" });
  assert.equal(a.codigo, 201);
  assert.equal(b.codigo, 200);
  assert.equal(b.corpo.duplicado, true);
  assert.equal(a.corpo.pedidoId, b.corpo.pedidoId);
  assert.equal(resumo().pedidos, 1);
});

test("preço adulterado no navegador é recusado (409) e nada é gravado", async () => {
  const r = await chamar(criarPedido, { corpo: corpoPedido(chaveDe(1), { totalEsperadoCentavos: 100 }), ip: "10.0.0.1" });
  assert.equal(r.codigo, 409);
  assert.equal(r.corpo.codigo, "preco_mudou");
  assert.equal(r.corpo.totalCentavos, 4100);
  assert.equal(resumo(), undefined);
});

test("fluxo completo até entregue soma faturamento, produtos e pagamento no resumo", async () => {
  const id = await novoPedido();
  await ate(id, "preparando", "saiu_para_entrega", "entregue");
  assert.equal(pedidoDoc(id).status, "entregue");
  assert.equal(acompDoc(id).status, "entregue");
  const r = resumo();
  assert.equal(r.entregues, 1);
  assert.equal(r.faturamentoCentavos, 4100);
  assert.equal(r.produtosCentavos, 3600);
  assert.equal(r.taxaEntregaCentavos, 500);
  assert.deepEqual(r.pagamentos, { pix: 1 });
  assert.deepEqual(r.produtos.p1, { nome: "X-Salada", quantidade: 2, receitaCentavos: 3000 });
  assert.equal(r.cancelados, undefined);
});

test("repetir 'entregue' (duplo toque) não soma duas vezes", async () => {
  const id = await novoPedido();
  await ate(id, "preparando", "saiu_para_entrega", "entregue");
  const de_novo = await status("donoR1", id, "entregue");
  assert.equal(de_novo.codigo, 200);
  assert.equal(de_novo.corpo.jaEstava, true);
  assert.equal(resumo().entregues, 1);
  assert.equal(resumo().faturamentoCentavos, 4100);
});

test("transição inválida é recusada (409) e não altera nada", async () => {
  const id = await novoPedido();
  const r = await status("donoR1", id, "entregue"); // novo > entregue pula etapas
  assert.equal(r.codigo, 409);
  assert.equal(pedidoDoc(id).status, "novo");
  assert.equal(resumo().entregues, undefined);
  await ate(id, "cancelado");
  assert.equal((await status("donoR1", id, "preparando")).codigo, 409); // cancelado é final
});

test("cancelar com motivo: conta cancelamento, não conta faturamento, cliente vê o motivo", async () => {
  const id = await novoPedido();
  const r = await status("donoR1", id, "cancelado", "Sem ingrediente");
  assert.equal(r.codigo, 200);
  assert.equal(pedidoDoc(id).motivoCancelamento, "Sem ingrediente");
  assert.equal(acompDoc(id).motivoCancelamento, "Sem ingrediente");
  assert.equal(acompDoc(id).status, "cancelado");
  const s = resumo();
  assert.equal(s.cancelados, 1);
  assert.equal(s.canceladosCentavos, 4100);
  assert.equal(s.faturamentoCentavos, undefined);
});

test("motivo muito longo é recusado (400)", async () => {
  const id = await novoPedido();
  const r = await status("donoR1", id, "cancelado", "x".repeat(121));
  assert.equal(r.codigo, 400);
  assert.equal(pedidoDoc(id).status, "novo");
});

test("sem login, sessão inválida, dono de outro restaurante e membro inativo: negados", async () => {
  const id = await novoPedido();
  assert.equal((await status(undefined, id, "preparando")).codigo, 401);
  assert.equal((await status("invalido", id, "preparando")).codigo, 401);
  assert.equal((await status("donoR2", id, "preparando")).codigo, 403);
  assert.equal((await status("desconhecido", id, "preparando")).codigo, 403);
  banco.gravar(`${R}/membros/donoR1`, { ativo: false });
  assert.equal((await status("donoR1", id, "preparando")).codigo, 403);
  assert.equal(pedidoDoc(id).status, "novo");
});

test("restaurante desativado: o dono não muda status; o Mestre muda", async () => {
  const id = await novoPedido();
  banco.gravar(R, { nome: "Lanchonete Teste", ativo: false, aberto: true, horarioAbertura: "00:00", horarioFechamento: "00:00", taxaEntregaCentavos: 500 });
  assert.equal((await status("donoR1", id, "preparando")).codigo, 403);
  assert.equal((await status(MASTER_UID, id, "preparando")).codigo, 200);
});

test("status inexistente, pedido inexistente e método errado", async () => {
  const id = await novoPedido();
  assert.equal((await status("donoR1", id, "voando")).codigo, 400);
  assert.equal((await status("donoR1", "z".repeat(32), "preparando")).codigo, 404);
  assert.equal((await chamar(atualizarStatus, { metodo: "GET" })).codigo, 405);
});

test("cliente cancela pedido novo: cancela na hora e conta no resumo", async () => {
  const id = await novoPedido();
  const r = await chamar(cancelarPedido, { corpo: { restauranteId: "r1", pedidoId: id } });
  assert.equal(r.codigo, 200);
  assert.equal(r.corpo.resultado, "cancelado");
  assert.equal(pedidoDoc(id).canceladoPor, "cliente");
  assert.equal(resumo().cancelados, 1);
});

test("cliente pede cancelamento de pedido em preparo: só registra o pedido, não conta cancelamento", async () => {
  const id = await novoPedido();
  await ate(id, "preparando");
  const r = await chamar(cancelarPedido, { corpo: { restauranteId: "r1", pedidoId: id } });
  assert.equal(r.corpo.resultado, "solicitado");
  assert.equal(pedidoDoc(id).cancelamentoSolicitado, true);
  assert.equal(pedidoDoc(id).status, "preparando");
  assert.equal(resumo().cancelados, undefined);
  // o restaurante então aceita o cancelamento
  await ate(id, "cancelado");
  assert.equal(resumo().cancelados, 1);
});

test("pedido antigo (sem resumoContado) muda de status sem criar nem mexer no resumo", async () => {
  banco.gravar(`${R}/pedidos/${"b".repeat(24)}`, {
    numero: 7, status: "preparando", totalCentavos: 2000, subtotalCentavos: 1500, taxaEntregaCentavos: 500,
    itens: [], pagamento: { forma: "dinheiro" }
  }); // sem acompanhamento e sem resumoContado
  const r = await status("donoR1", "b".repeat(24), "saiu_para_entrega");
  assert.equal(r.codigo, 200);
  assert.equal((await status("donoR1", "b".repeat(24), "entregue")).codigo, 200);
  assert.equal(banco.ler(`${R}/pedidos/${"b".repeat(24)}`).status, "entregue");
  assert.equal(banco.ler(`${R}/acompanhamento/${"b".repeat(24)}`), undefined);
  assert.equal(banco.caminhos().some((c) => c.includes("/resumos/")), false);
});

test("vários pedidos no mesmo dia acumulam no mesmo resumo", async () => {
  const a = await novoPedido(1);
  const b = await novoPedido(2);
  await ate(a, "preparando", "saiu_para_entrega", "entregue");
  await ate(b, "preparando", "saiu_para_entrega", "entregue");
  const r = resumo();
  assert.equal(r.pedidos, 2);
  assert.equal(r.entregues, 2);
  assert.equal(r.faturamentoCentavos, 8200);
  assert.equal(r.produtos.p1.quantidade, 4);
});
