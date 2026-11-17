// Deu Fome — utilidades compartilhadas das funções serverless (/api).
// O nome começa com "_" para a Vercel NÃO expor este arquivo como endereço.

const crypto = require("crypto");
const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { getAuth } = require("firebase-admin/auth");
const { waitUntil } = require("@vercel/functions");
const { derivarIdPedido } = require("./_id-pedido");

class ErroPedido extends Error {
  constructor(status, mensagem, extra = {}) {
    super(mensagem);
    this.status = status;
    this.extra = extra;
  }
}

// Chave secreta usada para gerar "hashes" (telefone e IP). Vem da própria conta de serviço,
// então não precisa de variável nova na Vercel.
let segredo = "";

function iniciarFirebase() {
  if (segredo && getApps().length) return getFirestore();
  let credencial;
  try {
    credencial = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || "");
  } catch (erro) {
    throw new ErroPedido(500, "Servidor sem configuração: a variável FIREBASE_SERVICE_ACCOUNT está ausente ou inválida.");
  }
  if (credencial.private_key) credencial.private_key = credencial.private_key.replace(/\\n/g, "\n");
  if (!credencial.private_key) {
    throw new ErroPedido(500, "Servidor sem configuração: a variável FIREBASE_SERVICE_ACCOUNT está ausente ou inválida.");
  }
  segredo = credencial.private_key;
  if (!getApps().length) initializeApp({ credential: cert(credencial) });
  return getFirestore();
}

// HMAC com a chave secreta: quem copiar o banco não consegue descobrir o telefone/IP por força bruta
function hash(valor) {
  if (!segredo) throw new ErroPedido(500, "Servidor sem configuração.");
  return crypto.createHmac("sha256", segredo).update(String(valor)).digest("hex");
}

// Código público do pedido (o que vai na URL de acompanhamento), gerado aqui e não no aparelho do cliente.
// A mesma chave de reenvio dá sempre o mesmo código, então reenviar não duplica o pedido.
function idPublicoDoPedido(restauranteId, chave) {
  if (!segredo) throw new ErroPedido(500, "Servidor sem configuração.");
  return derivarIdPedido(segredo, restauranteId, chave);
}

// Roda uma tarefa de segundo plano (ex.: push) sem atrasar a resposta ao cliente.
// Na Vercel usa waitUntil: volta na hora e a função fica viva até a tarefa terminar, mesmo depois da resposta.
// Se o ambiente não oferecer waitUntil, esta função espera a tarefa terminar (quem chama deve responder
// só depois): fica mais lento, mas nenhum aviso se perde. Chame ANTES de enviar a resposta HTTP.
async function emSegundoPlano(tarefa) {
  const promessa = Promise.resolve(tarefa).catch((erro) => console.error("segundo plano:", erro && erro.message));
  let temWaitUntil = false;
  try {
    const contexto = globalThis[Symbol.for("@vercel/request-context")];
    temWaitUntil = typeof (contexto && contexto.get && contexto.get() && contexto.get().waitUntil) === "function";
  } catch (erro) { /* sem contexto da Vercel */ }
  if (temWaitUntil) waitUntil(promessa);
  else await promessa;
}

// ---------- Quem está chamando (painel do restaurante) ----------
// ATENÇÃO: mesmo UID do isMaster() em firestore.rules. Se mudar um, mude o outro.
const MASTER_UID = "KZhENlWEtPNO5w2t6pgh8NTE0wW2";

// Confere o login (token do Firebase Auth enviado em "Authorization: Bearer ...") e devolve o UID.
async function usuarioDaRequisicao(req) {
  const m = /^Bearer (.+)$/.exec(String((req.headers || {}).authorization || ""));
  if (!m) throw new ErroPedido(401, "Entre na conta do restaurante para continuar.");
  try {
    return (await getAuth().verifyIdToken(m[1])).uid;
  } catch (erro) {
    throw new ErroPedido(401, "Sua sessão expirou. Entre de novo no painel.");
  }
}

// Só o Mestre ou um membro ATIVO de um restaurante ATIVO pode agir naquele restaurante
// (mesma regra de canManageRestaurant() em firestore.rules).
async function exigirGestor(db, uid, restauranteId) {
  if (uid === MASTER_UID) return;
  const restRef = db.collection("restaurantes").doc(restauranteId);
  const [rest, membro] = await Promise.all([restRef.get(), restRef.collection("membros").doc(uid).get()]);
  if (!rest.exists || rest.data().ativo !== true || !membro.exists || membro.data().ativo !== true) {
    throw new ErroPedido(403, "Esta conta não tem permissão neste restaurante.");
  }
}

// IP do cliente. Na Vercel, x-vercel-forwarded-for / x-forwarded-for são definidos pela própria Vercel.
function ipDoCliente(req) {
  const h = req.headers || {};
  const vercel = String(h["x-vercel-forwarded-for"] || "").split(",")[0].trim();
  const real = String(h["x-real-ip"] || "").trim();
  const encaminhado = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  return vercel || real || encaminhado || (req.socket && req.socket.remoteAddress) || "desconhecido";
}

// https://dominio do site (para o link da notificação). Retorna "" se o host for estranho.
function origemDe(req) {
  const h = req.headers || {};
  const host = String(h["x-forwarded-host"] || h.host || "").split(",")[0].trim();
  return /^[A-Za-z0-9.-]+(:\d{1,5})?$/.test(host) ? `https://${host}` : "";
}

function texto(valor, campo, min, max) {
  const t = String(valor == null ? "" : valor)
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length < min || t.length > max) throw new ErroPedido(400, `Verifique o campo: ${campo}.`);
  return t;
}

function lerCorpo(req) {
  const corpo = req.body;
  if (corpo && typeof corpo === "object") return corpo;
  if (typeof corpo === "string") {
    try { return JSON.parse(corpo); } catch (erro) { return {}; }
  }
  return {};
}

function moeda(centavos) {
  return "R$ " + (Number(centavos || 0) / 100).toFixed(2).replace(".", ",");
}

const TOKENS_INVALIDOS = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"];

// Envia uma notificação push para os aparelhos cadastrados do restaurante.
// NUNCA lança erro: se o aviso falhar, o pedido já foi gravado e segue normalmente.
async function enviarAviso(db, restauranteId, titulo, mensagem, origem) {
  const tarefa = (async () => {
    const snap = await db.collection("restaurantes").doc(restauranteId).collection("dispositivos").limit(20).get();
    const docs = snap.docs.filter((d) => typeof d.data().token === "string" && d.data().token);
    if (!docs.length) return;
    const webpush = {
      notification: { title: titulo, body: mensagem, tag: "deufome-pedido", renotify: true, requireInteraction: true, icon: "/icone.svg" }
    };
    if (origem) webpush.fcmOptions = { link: `${origem}/painel/pedidos` };
    const resposta = await getMessaging().sendEachForMulticast({ tokens: docs.map((d) => d.data().token), webpush });
    const apagar = [];
    resposta.responses.forEach((r, i) => {
      if (!r.success && r.error && TOKENS_INVALIDOS.includes(r.error.code)) apagar.push(docs[i].ref.delete());
    });
    await Promise.all(apagar);
  })();
  const limite = new Promise((resolve) => setTimeout(resolve, 5000));
  try {
    await Promise.race([tarefa, limite]);
  } catch (erro) {
    console.error("enviarAviso:", erro && erro.message);
  }
}

module.exports = {
  ErroPedido, iniciarFirebase, hash, idPublicoDoPedido, emSegundoPlano,
  MASTER_UID, usuarioDaRequisicao, exigirGestor,
  ipDoCliente, origemDe, texto, lerCorpo, moeda, enviarAviso
};
