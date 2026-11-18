// Deu Fome — login do CLIENTE com a conta Google.
// Usa um app Firebase separado ("cliente"): a sessão do cliente fica isolada da sessão do painel do restaurante
// no mesmo navegador (entrar como cliente NÃO desloga o dono, e vice-versa). O Firestore tem de ser o deste
// mesmo app (dbCliente), senão as regras enxergariam a sessão errada.
// O servidor só aceita pedido de quem entrou com o Google (api/_comum.js > clienteDaRequisicao).
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const appCliente = initializeApp(firebaseConfig, "cliente");
export const authCliente = getAuth(appCliente);
export const dbCliente = getFirestore(appCliente);

// Chama a função com o usuário (ou null) agora e a cada entrada/saída
export function aoMudarLogin(callback) {
  return onAuthStateChanged(authCliente, callback);
}

// Abre a janela de login do Google. Devolve false se a pessoa fechou a janela sem entrar.
// Chamar a partir de um toque do usuário (senão o navegador bloqueia a janela).
export async function entrarComGoogle() {
  const provedor = new GoogleAuthProvider();
  provedor.setCustomParameters({ prompt: "select_account" });
  try {
    await signInWithPopup(authCliente, provedor);
    return true;
  } catch (erro) {
    if (erro && (erro.code === "auth/popup-closed-by-user" || erro.code === "auth/cancelled-popup-request")) return false;
    throw erro;
  }
}

export function sairDaConta() {
  return signOut(authCliente);
}

// Token de login enviado ao servidor em "Authorization: Bearer ..."
export async function tokenDoCliente() {
  if (!authCliente.currentUser) throw new Error("Entre com o Google para continuar.");
  return authCliente.currentUser.getIdToken();
}
