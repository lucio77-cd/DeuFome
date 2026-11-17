// Deu Fome — gravação do resumo diário dentro de transações (usa o Firebase Admin).
// As regras de cálculo ficam em _status-regras.js (sem dependências, testáveis).
// O nome começa com "_" para a Vercel NÃO expor este arquivo como endereço.

const { FieldValue } = require("firebase-admin/firestore");
const { diaSP, deltaResumo, paraIncrementos } = require("./_status-regras");

// Soma o evento no resumo do dia do pedido. Chamar DENTRO da transação, junto das outras gravações
// (não precisa ler antes: o set com merge e increment() é atômico).
// - Pedidos antigos, de antes do resumo, não têm resumoContado e são ignorados (o resumo não fica torto).
// - O dia vem de pedido.resumoDia (gravado na criação), assim todos os eventos de um pedido caem no
//   mesmo documento, mesmo perto da meia-noite.
function gravarResumo(t, restRef, pedido, evento, dataCriacao) {
  if (pedido.resumoContado !== true) return;
  const criadoEm = dataCriacao
    || (pedido.criadoEm && typeof pedido.criadoEm.toDate === "function" ? pedido.criadoEm.toDate() : null);
  const dia = typeof pedido.resumoDia === "string" ? pedido.resumoDia : (criadoEm ? diaSP(criadoEm) : null);
  if (!dia) return;
  const delta = deltaResumo(pedido, evento.tipo === "criado" ? { ...evento, data: criadoEm || new Date() } : evento);
  if (!delta) return;
  t.set(
    restRef.collection("resumos").doc(dia),
    { dia, ...paraIncrementos(delta, (n) => FieldValue.increment(n)), atualizadoEm: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

// Pedido cancelado devolve o uso do cupom (o cliente não perde o cupom por culpa do cancelamento).
// ATENÇÃO: faz uma LEITURA, então chame ANTES de qualquer t.update/t.set da transação (o Firestore exige
// todas as leituras antes das gravações). Se o cupom foi apagado ou já está em zero, não faz nada.
async function devolverUsoDoCupom(t, restRef, pedido) {
  const codigo = pedido.cupom && pedido.cupom.codigo;
  if (!codigo) return false;
  const ref = restRef.collection("cupons").doc(String(codigo));
  const snap = await t.get(ref);
  if (!snap.exists || !(Number(snap.data().usos) > 0)) return false;
  t.update(ref, { usos: FieldValue.increment(-1) });
  return true;
}

module.exports = { gravarResumo, devolverUsoDoCupom };
