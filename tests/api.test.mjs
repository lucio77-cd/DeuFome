// Deu Fome — testes de integração das funções /api com um Firestore FALSO em memória (sem emulador).
// Conferem a lógica das transações: criar pedido, mudar status, cancelar e o resumo diário.
// NÃO conferem as regras de segurança do Firestore (isso é o regras.test.mjs, no emulador).
// Rodar: node --test tests/api.test.mjs
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { banco, chamar, Ts } = require("./_firebase-falso.cjs"); // ANTES de carregar as funções
const criarPedido = require("../api/criar-pedido.js");
const atualizarStatus = require("../api/atualizar-status.js");
const cancelarPedido = require("../api/cancelar-pedido.js");
const validarCupom = require("../api/validar-cupom.js");
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

// ---------- Etapa 5: custo congelado no pedido ----------
const receita = (produtoId, custoMicro) => banco.gravar(`${R}/receitas/${produtoId}`, { itens: [], custoExtraMicro: 0, custoMicro });

test("o pedido grava o custo de cada item no momento da venda, e o cliente não vê custo nenhum", async () => {
  receita("p1", 4500000); // X-Salada custa R$ 4,50
  receita("p2", 1200000); // Suco custa R$ 1,20
  const id = await novoPedido();
  const p = pedidoDoc(id);
  assert.equal(p.custoCompleto, true);
  assert.equal(p.custoTotalMicro, 2 * 4500000 + 1200000);
  assert.deepEqual(p.itens.map((i) => i.custoUnitarioMicro), [4500000, 1200000]);
  const publico = JSON.stringify(acompDoc(id));
  assert.ok(!/custo/i.test(publico), "o acompanhamento público não pode ter custo");
});

test("subir o preço do ingrediente NÃO muda o lucro dos pedidos antigos (teste do queijo)", async () => {
  receita("p1", 4500000);
  receita("p2", 1200000);
  const antigo = await novoPedido(1);
  receita("p1", 9000000); // o queijo subiu: o X-Salada passou a custar R$ 9,00
  const novo = await novoPedido(2);
  assert.equal(pedidoDoc(antigo).custoTotalMicro, 2 * 4500000 + 1200000); // continua o custo da época
  assert.equal(pedidoDoc(novo).custoTotalMicro, 2 * 9000000 + 1200000);
  await ate(antigo, "preparando", "saiu_para_entrega", "entregue");
  await ate(novo, "preparando", "saiu_para_entrega", "entregue");
  const r = resumo();
  assert.equal(r.custoMicro, (2 * 4500000 + 1200000) + (2 * 9000000 + 1200000));
  assert.equal(r.pedidosComCusto, 2);
});

test("produto sem receita: pedido fica com custo incompleto e fora da margem", async () => {
  receita("p1", 4500000); // p2 (Suco) sem receita
  const id = await novoPedido();
  const p = pedidoDoc(id);
  assert.equal(p.custoCompleto, false);
  assert.equal(p.custoTotalMicro, null);
  assert.equal(p.itens[1].custoUnitarioMicro, null);
  await ate(id, "preparando", "saiu_para_entrega", "entregue");
  assert.equal(resumo().entregues, 1);
  assert.equal(resumo().pedidosComCusto, undefined);
  assert.equal(resumo().custoMicro, undefined);
});

test("receita com custo inválido (texto, negativo, quebrado) é ignorada em vez de quebrar o pedido", async () => {
  banco.gravar(`${R}/receitas/p1`, { custoMicro: "caro" });
  banco.gravar(`${R}/receitas/p2`, { custoMicro: -5 });
  const id = await novoPedido();
  assert.equal(pedidoDoc(id).custoCompleto, false);
  assert.equal(pedidoDoc(id).itens[0].custoUnitarioMicro, null);
});

// ---------- Cupons (Etapa 6) ----------
const CUPOM = (extra = {}) => ({ codigo: "PROMO10", tipo: "percentual", valor: 10, minimoCentavos: 0, validadeAte: null, limiteUsos: null, usos: 0, ativo: true, ...extra });
const semearCupom = (extra) => banco.gravar(`${R}/cupons/PROMO10`, CUPOM(extra));
const usos = () => banco.ler(`${R}/cupons/PROMO10`).usos;
const pedidosGravados = () => banco.caminhos().filter((c) => c.startsWith(`${R}/pedidos/`)).length;
// Subtotal 3600 (2 x 1500 + 600) + entrega 500. Com 10%: 3600 - 360 + 500 = 3740.
const comCupom = (n, extra = {}, total = 3740) => chamar(criarPedido, {
  corpo: corpoPedido(chaveDe(n), { cupom: "promo10", totalEsperadoCentavos: total, ...extra }), ip: `10.0.1.${n}`
});

test("cupom percentual: servidor calcula o desconto, grava no pedido e soma 1 uso", async () => {
  semearCupom();
  const r = await comCupom(1);
  assert.equal(r.codigo, 201, JSON.stringify(r.corpo));
  assert.equal(r.corpo.totalCentavos, 3740);
  const p = pedidoDoc(r.corpo.pedidoId);
  assert.equal(p.descontoCentavos, 360);
  assert.equal(p.taxaEntregaCentavos, 500);
  assert.deepEqual(p.cupom, { codigo: "PROMO10", tipo: "percentual", valor: 10 });
  assert.equal(acompDoc(r.corpo.pedidoId).cupomCodigo, "PROMO10");
  assert.equal(acompDoc(r.corpo.pedidoId).descontoCentavos, 360);
  assert.equal(usos(), 1);
});

test("desconto adulterado no navegador é recusado: o total esperado precisa bater com o do servidor", async () => {
  semearCupom();
  const r = await comCupom(1, {}, 100); // cliente "calculou" um total qualquer
  assert.equal(r.codigo, 409);
  assert.equal(r.corpo.codigo, "preco_mudou");
  assert.equal(r.corpo.totalCentavos, 3740);
  assert.equal(usos(), 0);
  assert.equal(pedidosGravados(), 0);
});

test("pedido sem cupom continua igual: sem desconto e sem tocar em cupom algum", async () => {
  semearCupom();
  const id = await novoPedido();
  assert.equal(pedidoDoc(id).descontoCentavos, 0);
  assert.equal(pedidoDoc(id).cupom, null);
  assert.equal(usos(), 0);
});

test("limite de usos: depois do último uso o cupom é recusado e nenhum pedido novo é gravado", async () => {
  semearCupom({ limiteUsos: 1 });
  assert.equal((await comCupom(1)).codigo, 201);
  const segundo = await comCupom(2);
  assert.equal(segundo.codigo, 409);
  assert.equal(segundo.corpo.codigo, "cupom_invalido");
  assert.match(segundo.corpo.erro, /limite/);
  assert.equal(usos(), 1);
  assert.equal(pedidosGravados(), 1);
});

test("cancelar pelo restaurante devolve o uso do cupom, e o cupom volta a valer", async () => {
  semearCupom({ limiteUsos: 1 });
  const a = await comCupom(1);
  assert.equal(usos(), 1);
  assert.equal((await status("donoR1", a.corpo.pedidoId, "cancelado", "Sem ingrediente")).codigo, 200);
  assert.equal(usos(), 0);
  assert.equal((await comCupom(2)).codigo, 201); // o uso devolvido está livre de novo
  assert.equal(usos(), 1);
});

test("cancelar pelo cliente devolve o uso do cupom", async () => {
  semearCupom({ limiteUsos: 5 });
  const a = await comCupom(1);
  assert.equal(usos(), 1);
  const c = await chamar(cancelarPedido, { corpo: { restauranteId: "r1", pedidoId: a.corpo.pedidoId } });
  assert.equal(c.corpo.resultado, "cancelado");
  assert.equal(usos(), 0);
});

test("cancelar duas vezes não devolve o uso duas vezes", async () => {
  semearCupom({ limiteUsos: 5 });
  const a = await comCupom(1);
  await comCupom(2);
  assert.equal(usos(), 2);
  await status("donoR1", a.corpo.pedidoId, "cancelado");
  const de_novo = await status("donoR1", a.corpo.pedidoId, "cancelado");
  assert.equal(de_novo.corpo.jaEstava, true);
  assert.equal(usos(), 1);
});

test("cupom vencido, abaixo do mínimo, inexistente e desativado são recusados", async () => {
  semearCupom({ validadeAte: new Ts(Date.now() - 60000) });
  let r = await comCupom(1);
  assert.equal(r.codigo, 409);
  assert.match(r.corpo.erro, /vencido/);

  semearCupom({ minimoCentavos: 5000 });
  r = await comCupom(2);
  assert.equal(r.codigo, 409);
  assert.match(r.corpo.erro, /a partir de R\$ 50,00/);

  semearCupom({ ativo: false });
  r = await comCupom(3);
  assert.equal(r.corpo.erro, "Cupom inválido.");

  banco.limpar(); semear();
  r = await comCupom(4);
  assert.equal(r.corpo.erro, "Cupom inválido.");
  assert.equal(pedidosGravados(), 0);
});

test("cupom fixo maior que os produtos zera os produtos, mas a entrega continua cobrada", async () => {
  semearCupom({ tipo: "fixo", valor: 9000 });
  const r = await comCupom(1, {}, 500);
  assert.equal(r.codigo, 201, JSON.stringify(r.corpo));
  assert.equal(pedidoDoc(r.corpo.pedidoId).descontoCentavos, 3600);
});

test("frete grátis: taxa cobrada vira 0, a original fica registrada e o resumo mostra o frete perdoado", async () => {
  semearCupom({ tipo: "frete_gratis", valor: 0 });
  const r = await comCupom(1, {}, 3600);
  assert.equal(r.codigo, 201, JSON.stringify(r.corpo));
  const p = pedidoDoc(r.corpo.pedidoId);
  assert.equal(p.taxaEntregaCentavos, 0);
  assert.equal(p.taxaOriginalCentavos, 500);
  await ate(r.corpo.pedidoId, "preparando", "saiu_para_entrega", "entregue");
  assert.equal(resumo().descontoEntregaCentavos, 500);
  assert.equal(resumo().faturamentoCentavos, 3600);
});

test("resumo diário registra desconto e uso do cupom só quando entrega; cancelado não conta como cupom usado", async () => {
  semearCupom();
  const entregue = await comCupom(1);
  const cancelado = await comCupom(2);
  await ate(entregue.corpo.pedidoId, "preparando", "saiu_para_entrega", "entregue");
  await status("donoR1", cancelado.corpo.pedidoId, "cancelado");
  const r = resumo();
  assert.equal(r.entregues, 1);
  assert.equal(r.cancelados, 1);
  assert.equal(r.descontoCentavos, 360);
  assert.equal(r.produtosCentavos, 3240); // 3600 - 360
  assert.equal(r.faturamentoCentavos, 3740);
  assert.deepEqual(r.cupons, { PROMO10: 1 });
  assert.equal(usos(), 1); // o cancelado devolveu o uso
});

test("validar-cupom: devolve o desconto e o total calculados no servidor, sem gastar um uso", async () => {
  semearCupom({ limiteUsos: 1 });
  const itens = [{ produtoId: "p1", quantidade: 2 }, { produtoId: "p2", quantidade: 1 }];
  const r = await chamar(validarCupom, { corpo: { restauranteId: "r1", codigo: "promo10", itens } });
  assert.equal(r.codigo, 200, JSON.stringify(r.corpo));
  assert.equal(r.corpo.codigo, "PROMO10");
  assert.equal(r.corpo.subtotalCentavos, 3600);
  assert.equal(r.corpo.descontoCentavos, 360);
  assert.equal(r.corpo.taxaCentavos, 500);
  assert.equal(r.corpo.totalCentavos, 3740);
  assert.equal(usos(), 0); // conferir não consome o cupom
});

test("validar-cupom: código inexistente, item indisponível e método errado", async () => {
  semearCupom();
  const itens = [{ produtoId: "p1", quantidade: 1 }];
  let r = await chamar(validarCupom, { corpo: { restauranteId: "r1", codigo: "naoexiste", itens } });
  assert.equal(r.codigo, 409);
  assert.equal(r.corpo.codigo, "cupom_invalido");

  banco.gravar(`${R}/produtos/p2`, { nome: "Suco", precoCentavos: 600, ativo: true, disponivel: false, categoriaId: "cat1" });
  r = await chamar(validarCupom, { corpo: { restauranteId: "r1", codigo: "promo10", itens: [{ produtoId: "p2", quantidade: 1 }] } });
  assert.equal(r.codigo, 409);
  assert.equal(r.corpo.codigo, "produto_indisponivel");

  r = await chamar(validarCupom, { metodo: "GET" });
  assert.equal(r.codigo, 405);
});

test("validar-cupom: depois de 20 tentativas em 10 minutos o mesmo IP é bloqueado (impede adivinhar códigos)", async () => {
  semearCupom();
  const corpo = { restauranteId: "r1", codigo: "chute", itens: [{ produtoId: "p1", quantidade: 1 }] };
  for (let i = 0; i < 20; i++) {
    const r = await chamar(validarCupom, { corpo, ip: "9.9.9.9" });
    assert.equal(r.codigo, 409, `tentativa ${i + 1}`);
  }
  const r = await chamar(validarCupom, { corpo, ip: "9.9.9.9" });
  assert.equal(r.codigo, 429);
  const outro = await chamar(validarCupom, { corpo, ip: "8.8.8.8" }); // outro IP não é afetado
  assert.equal(outro.codigo, 409);
});
