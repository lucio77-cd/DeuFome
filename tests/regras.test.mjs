// Deu Fome — testes do firestore.rules no emulador do Firestore.
// Rodar (precisa de Java e Node): cd tests && npm install && npm test
// O que cobre: o pedido completo (com telefone e endereço) é privado, o acompanhamento é público
// sem listagem, só o restaurante certo muda status (transição válida) e os aparelhos de push.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from "firebase/firestore";

const MESTRE = "KZhENlWEtPNO5w2t6pgh8NTE0wW2";
const DONO_A = "donoRestauranteA00000000001";
const DONO_B = "donoRestauranteB00000000002";
const REST_A = "restA";
const REST_B = "restB";
const PEDIDO = "abcdef0123456789abcdef01"; // 24 caracteres

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-deufome",
    firestore: { rules: readFileSync(new URL("../firestore.rules", import.meta.url), "utf8") }
  });
});
after(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [id, dono] of [[REST_A, DONO_A], [REST_B, DONO_B]]) {
      await setDoc(doc(db, "restaurantes", id), { nome: id, ativo: true, aberto: true });
      await setDoc(doc(db, "restaurantes", id, "membros", dono), { uid: dono, ativo: true });
      await setDoc(doc(db, "restaurantes", id, "pedidos", PEDIDO), {
        numero: 1, status: "novo", cliente: { nome: "Ana", telefone: "49999999999" },
        entrega: { endereco: "Rua A, 1" }, totalCentavos: 1000
      });
      await setDoc(doc(db, "restaurantes", id, "acompanhamento", PEDIDO), {
        numero: 1, status: "novo", primeiroNome: "Ana", totalCentavos: 1000
      });
    }
  });
});

const anonimo = () => env.unauthenticatedContext().firestore();
const como = (uid) => env.authenticatedContext(uid).firestore();
const pedidoRef = (db, r = REST_A) => doc(db, "restaurantes", r, "pedidos", PEDIDO);
const acompRef = (db, r = REST_A) => doc(db, "restaurantes", r, "acompanhamento", PEDIDO);

async function mudar(db, restaurante, dados) {
  const lote = writeBatch(db);
  lote.update(pedidoRef(db, restaurante), { ...dados, atualizadoEm: serverTimestamp() });
  lote.update(acompRef(db, restaurante), { ...dados, atualizadoEm: serverTimestamp() });
  return lote.commit();
}

test("pedido completo (dados pessoais) é privado", async () => {
  await assertFails(getDoc(pedidoRef(anonimo())));
  await assertFails(getDoc(pedidoRef(como(DONO_B)))); // dono de OUTRO restaurante
  await assertFails(getDocs(collection(anonimo(), "restaurantes", REST_A, "pedidos")));
  await assertSucceeds(getDoc(pedidoRef(como(DONO_A))));
  await assertSucceeds(getDocs(collection(como(DONO_A), "restaurantes", REST_A, "pedidos")));
  await assertSucceeds(getDoc(pedidoRef(como(MESTRE))));
});

test("acompanhamento: qualquer um lê um, ninguém lista nem cria", async () => {
  await assertSucceeds(getDoc(acompRef(anonimo())));
  await assertFails(getDocs(collection(anonimo(), "restaurantes", REST_A, "acompanhamento")));
  await assertFails(setDoc(doc(anonimo(), "restaurantes", REST_A, "acompanhamento", "novoIdNovoIdNovoIdNovo1"), { status: "novo" }));
  await assertFails(setDoc(doc(como(DONO_A), "restaurantes", REST_A, "acompanhamento", "novoIdNovoIdNovoIdNovo1"), { status: "novo" }));
});

test("pedido nunca é criado nem apagado pelo navegador", async () => {
  await assertFails(setDoc(doc(como(DONO_A), "restaurantes", REST_A, "pedidos", "outroIdOutroIdOutroId001"), { status: "novo" }));
  await assertFails(deleteDoc(pedidoRef(como(DONO_A))));
  await assertFails(deleteDoc(acompRef(como(DONO_A))));
});

test("restaurante muda o status nos dois documentos, com transição válida", async () => {
  await assertSucceeds(mudar(como(DONO_A), REST_A, { status: "preparando" }));
  await assertSucceeds(mudar(como(DONO_A), REST_A, { status: "saiu_para_entrega" }));
  await assertSucceeds(mudar(como(DONO_A), REST_A, { status: "entregue" }));
  await assertFails(mudar(como(DONO_A), REST_A, { status: "cancelado" })); // entregue não cancela
});

test("transição inválida e dono de outro restaurante são negados", async () => {
  await assertFails(mudar(como(DONO_A), REST_A, { status: "entregue" })); // pulou etapas
  await assertFails(mudar(como(DONO_B), REST_A, { status: "preparando" }));
  await assertFails(mudar(anonimo(), REST_A, { status: "preparando" }));
});

test("cancelamento com motivo: só com status cancelado e até 120 caracteres", async () => {
  await assertSucceeds(mudar(como(DONO_A), REST_A, { status: "cancelado", motivoCancelamento: "Sem ingrediente" }));
  await assertFails(mudar(como(DONO_A), REST_A, { status: "preparando", motivoCancelamento: "x" }));
  await assertFails(mudar(como(DONO_A), REST_A, { status: "cancelado", motivoCancelamento: "x".repeat(121) }));
});

test("restaurante não altera outros campos do pedido nem do acompanhamento", async () => {
  await assertFails(mudar(como(DONO_A), REST_A, { status: "preparando", totalCentavos: 1 }));
  await assertFails(updateDoc(pedidoRef(como(DONO_A)), { cancelamentoSolicitado: true, atualizadoEm: serverTimestamp() }));
});

test("dispositivos de push: o dono cadastra o próprio aparelho; ninguém lê", async () => {
  const token = "tokenFCM:APA91bExemplo";
  const ref = (db, r = REST_A, t = token) => doc(db, "restaurantes", r, "dispositivos", t);
  const dados = (uid, t = token) => ({ token: t, uid, atualizadoEm: serverTimestamp() });

  await assertSucceeds(setDoc(ref(como(DONO_A)), dados(DONO_A)));
  await assertSucceeds(setDoc(ref(como(DONO_A)), dados(DONO_A))); // renovação (update)
  await assertFails(setDoc(ref(como(DONO_A)), dados(DONO_B)));          // uid de outra pessoa
  await assertFails(setDoc(ref(como(DONO_A)), dados(DONO_A, "outro"))); // token diferente do ID
  await assertFails(setDoc(ref(como(DONO_B)), dados(DONO_B)));          // dono de outro restaurante
  await assertFails(setDoc(ref(anonimo()), dados(DONO_A)));
  await assertFails(getDoc(ref(como(DONO_A))));                         // só o servidor lê
  await assertSucceeds(deleteDoc(ref(como(DONO_A))));
});
