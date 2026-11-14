import { auth, db } from "../js/firebase-config.js";
import { $, mensagemErroFirebase, escapeHtml } from "../js/utils.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDocs, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const MASTER_UID = "KZhENlWEtPNO5w2t6pgh8NTE0wW2";
const loginCard = $("#loginCard");
const appArea = $("#app");
const lista = $("#listaRestaurantes");

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginErro").textContent = "";
  try {
    const credential = await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#senha").value);
    if (credential.user.uid !== MASTER_UID) {
      await signOut(auth);
      throw new Error("Esta conta não é a conta Mestre autorizada.");
    }
  } catch (error) {
    $("#loginErro").textContent = mensagemErroFirebase(error);
  }
});
$("#sair").addEventListener("click", () => signOut(auth));
$("#atualizar").addEventListener("click", carregarRestaurantes);

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    loginCard.classList.remove("oculto");
    appArea.classList.add("oculto");
    return;
  }
  if (user.uid !== MASTER_UID) {
    await signOut(auth);
    $("#loginErro").textContent = "Acesso restrito à conta Mestre.";
    return;
  }
  loginCard.classList.add("oculto");
  appArea.classList.remove("oculto");
  await carregarRestaurantes();
});

$("#restauranteForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const nome = $("#nome").value.trim();
  const ownerUid = $("#ownerUid").value.trim();
  const msg = $("#formMsg");
  msg.textContent = "";
  if (nome.length < 2 || ownerUid.length < 10) {
    msg.textContent = "Confira o nome e o UID informado.";
    msg.className = "mensagem erro";
    return;
  }
  const botao = event.submitter;
  botao.disabled = true;
  try {
    const restauranteRef = doc(collection(db, "restaurantes"));
    const membroRef = doc(db, "restaurantes", restauranteRef.id, "membros", ownerUid);
    const indiceRef = doc(db, "usuarios", ownerUid, "restaurantes", restauranteRef.id);
    const batch = writeBatch(db);
    batch.set(restauranteRef, {
      nome, taxaEntregaCentavos: 0, horarioAbertura: "09:00", horarioFechamento: "22:00",
      aberto: false, ativo: true, criadoPor: auth.currentUser.uid,
      criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp()
    });
    batch.set(membroRef, { uid: ownerUid, papel: "responsavel", ativo: true, criadoEm: serverTimestamp() });
    batch.set(indiceRef, { restauranteId: restauranteRef.id, nome, ativo: true, criadoEm: serverTimestamp() });
    await batch.commit();
    $("#restauranteForm").reset();
    msg.textContent = "Restaurante cadastrado e conta vinculada.";
    msg.className = "mensagem sucesso";
    await carregarRestaurantes();
  } catch (error) {
    msg.textContent = mensagemErroFirebase(error);
    msg.className = "mensagem erro";
  } finally {
    botao.disabled = false;
  }
});

async function carregarRestaurantes() {
  lista.innerHTML = "<p class='texto-suave'>Carregando...</p>";
  try {
    const snapshot = await getDocs(collection(db, "restaurantes"));
    if (snapshot.empty) {
      lista.innerHTML = "<p class='texto-suave'>Nenhum restaurante cadastrado ainda.</p>";
      return;
    }
    lista.innerHTML = "";
    snapshot.forEach((item) => {
      const data = item.data();
      const linha = document.createElement("article");
      linha.className = "item-lista";
      linha.innerHTML = "<div><strong>" + escapeHtml(data.nome || "Sem nome") +
        "</strong><small>ID: " + escapeHtml(item.id) + "</small></div><span class='selo " +
        (data.ativo ? "selo-ok'>Ativo" : "selo-aviso'>Inativo") + "</span>";
      lista.appendChild(linha);
    });
  } catch (error) {
    lista.innerHTML = "<p class='mensagem erro'>" + escapeHtml(mensagemErroFirebase(error)) + "</p>";
  }
}
