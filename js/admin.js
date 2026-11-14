// Deu Fome — painel do Mestre (Etapa 1)
// A tela só mostra/esconde; quem protege os dados é o firestore.rules (isMaster()).

import { auth, db, MASTER_UID } from "./firebase-config.js";
import { $, criar, botaoDe, executar, mensagemErroFirebase, toast } from "./utils.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDocs, query, orderBy, writeBatch, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// UID do Firebase Authentication: letras e números (normalmente 28 caracteres). Pega erro de digitação grosseiro.
const FORMATO_UID = /^[A-Za-z0-9]{20,128}$/;

const lista = $("#listaRestaurantes");
let carga = 0;

// ---------- Login ----------
$("#loginForm").addEventListener("submit", (evento) => {
  evento.preventDefault();
  $("#loginErro").textContent = "";
  executar(botaoDe(evento), async () => {
    try {
      await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#senha").value);
      $("#senha").value = "";
    } catch (erro) {
      $("#loginErro").textContent = mensagemErroFirebase(erro);
    }
  });
});

$("#sair").addEventListener("click", () => signOut(auth));
$("#atualizar").addEventListener("click", () => carregarRestaurantes());

onAuthStateChanged(auth, async (user) => {
  const minha = ++carga;
  lista.replaceChildren();
  if (user && user.uid !== MASTER_UID) {
    await signOut(auth);
    $("#loginErro").textContent = "Esta conta não é a conta Mestre autorizada.";
    return;
  }
  $("#loginCard").classList.toggle("oculto", !!user);
  $("#app").classList.toggle("oculto", !user);
  if (user) await carregarRestaurantes(minha);
});

// ---------- Cadastro ----------
$("#restauranteForm").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const msg = $("#formMsg");
  msg.textContent = "";
  msg.className = "mensagem";

  const nome = $("#nome").value.trim();
  const ownerUid = $("#ownerUid").value.trim();
  if (nome.length < 2 || nome.length > 80) return mostrarErro(msg, "O nome precisa ter de 2 a 80 caracteres.");
  if (!FORMATO_UID.test(ownerUid)) return mostrarErro(msg, "UID inválido. Copie de novo em Firebase Console → Authentication → Users.");
  if (!confirm(`Vincular o UID ${ownerUid} ao restaurante "${nome}"?\n\nConfira se é a conta certa: o responsável passa a gerenciar o cardápio.`)) return;

  executar(botaoDe(evento), async () => {
    const restauranteRef = doc(collection(db, "restaurantes"));
    const batch = writeBatch(db);
    batch.set(restauranteRef, {
      nome, taxaEntregaCentavos: 0, horarioAbertura: "09:00", horarioFechamento: "22:00",
      aberto: false, ativo: true, criadoPor: auth.currentUser.uid,
      criadoEm: serverTimestamp(), atualizadoEm: serverTimestamp()
    });
    batch.set(doc(db, "restaurantes", restauranteRef.id, "membros", ownerUid),
      { uid: ownerUid, papel: "responsavel", ativo: true, criadoEm: serverTimestamp() });
    batch.set(doc(db, "usuarios", ownerUid, "restaurantes", restauranteRef.id),
      { restauranteId: restauranteRef.id, nome, ativo: true, criadoEm: serverTimestamp() });
    await batch.commit();
    $("#restauranteForm").reset();
    msg.textContent = "Restaurante cadastrado e conta vinculada.";
    msg.className = "mensagem sucesso";
    await carregarRestaurantes();
  });
});

function mostrarErro(elemento, texto) {
  elemento.textContent = texto;
  elemento.className = "mensagem erro";
}

// ---------- Lista ----------
async function carregarRestaurantes(minha = ++carga) {
  lista.replaceChildren(criar("p", { class: "texto-suave", texto: "Carregando..." }));
  try {
    const snapshot = await getDocs(query(collection(db, "restaurantes"), orderBy("criadoEm", "desc")));
    if (minha !== carga) return;
    lista.replaceChildren();
    if (snapshot.empty) {
      lista.append(criar("p", { class: "texto-suave", texto: "Nenhum restaurante cadastrado ainda." }));
      return;
    }
    snapshot.forEach((item) => {
      const dados = item.data();
      const ativo = dados.ativo !== false;
      lista.append(criar("article", { class: "item-lista" },
        criar("div", {},
          criar("strong", { texto: dados.nome || "Sem nome" }),
          " ",
          criar("span", { class: ativo ? "selo selo-ok" : "selo selo-aviso", texto: ativo ? "Ativo" : "Desativado" }),
          criar("small", { texto: `ID: ${item.id}` })),
        criar("button", {
          class: "btn btn-secundario btn-pequeno", type: "button",
          texto: ativo ? "Desativar" : "Reativar",
          "data-id": item.id, "data-nome": dados.nome || "", "data-ativar": String(!ativo)
        })
      ));
    });
  } catch (erro) {
    if (minha !== carga) return;
    lista.replaceChildren(criar("p", { class: "mensagem erro", texto: mensagemErroFirebase(erro) }));
  }
}

// Desativar/reativar: restaurante, vínculos (membros) e índice de cada usuário, tudo em uma operação só
lista.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-id]");
  if (!botao) return;
  const { id, nome } = botao.dataset;
  const ativar = botao.dataset.ativar === "true";
  const pergunta = ativar
    ? `Reativar "${nome}"? Os responsáveis voltam a acessar o painel.`
    : `Desativar "${nome}"? Os responsáveis perdem o acesso ao painel. Nada é apagado e dá para reativar depois.`;
  if (!confirm(pergunta)) return;

  executar(botao, async () => {
    const membros = await getDocs(collection(db, "restaurantes", id, "membros"));
    const batch = writeBatch(db);
    batch.update(doc(db, "restaurantes", id), { ativo: ativar, atualizadoEm: serverTimestamp() });
    membros.forEach((membro) => {
      batch.update(membro.ref, { ativo: ativar });
      batch.update(doc(db, "usuarios", membro.id, "restaurantes", id), { ativo: ativar });
    });
    await batch.commit();
    await carregarRestaurantes();
    toast(ativar ? "Restaurante reativado." : "Restaurante desativado.", "sucesso");
  });
});
