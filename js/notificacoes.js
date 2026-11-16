// Deu Fome — avisos push do painel do restaurante (Firebase Cloud Messaging).
// O aparelho se registra em restaurantes/{id}/dispositivos/{token}; o servidor (/api/criar-pedido)
// envia a notificação quando chega um pedido novo.
import { app, auth, db } from "./firebase-config.js";
import { getMessaging, getToken, isSupported } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging.js";
import { doc, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Opcional: chave pública VAPID (Console Firebase > Configurações do projeto > Cloud Messaging > Certificados push da Web).
// Deixe vazio para usar a chave padrão do Firebase.
const VAPID_KEY = "";
const SW_URL = "/firebase-messaging-sw.js";

let messaging = null;

export async function suportado() {
  try {
    if (!("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window)) return false;
    return await isSupported();
  } catch (erro) {
    return false;
  }
}

// "default" (ainda não perguntou), "granted" (liberado) ou "denied" (bloqueado)
export function permissao() {
  return "Notification" in window ? Notification.permission : "denied";
}

async function obterToken() {
  const registro = await navigator.serviceWorker.register(SW_URL);
  if (!messaging) messaging = getMessaging(app);
  const opcoes = { serviceWorkerRegistration: registro };
  if (VAPID_KEY) opcoes.vapidKey = VAPID_KEY;
  const token = await getToken(messaging, opcoes);
  if (!token) throw new Error("Não foi possível ativar os avisos neste aparelho.");
  return token;
}

async function guardarToken(restauranteId, token) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error("Entre na conta do restaurante primeiro.");
  await setDoc(doc(db, "restaurantes", restauranteId, "dispositivos", token), {
    token, uid: usuario.uid, atualizadoEm: serverTimestamp()
  });
}

// Chamar a partir de um toque do usuário (o navegador exige isso para pedir permissão)
export async function ativar(restauranteId) {
  const resultado = await Notification.requestPermission();
  if (resultado !== "granted") {
    throw new Error("Permissão negada. Libere as notificações deste site nas configurações do navegador.");
  }
  await guardarToken(restauranteId, await obterToken());
}

// Se já estava liberado, renova o cadastro do aparelho (o token pode mudar com o tempo)
export async function sincronizar(restauranteId) {
  if (permissao() !== "granted") return false;
  await guardarToken(restauranteId, await obterToken());
  return true;
}

// Para de avisar este aparelho para este restaurante
export async function desativar(restauranteId) {
  const token = await obterToken();
  await deleteDoc(doc(db, "restaurantes", restauranteId, "dispositivos", token));
}
