// Deu Fome — página de diagnóstico: confere configuração, regras e isolamento entre contas.
// Rode sem login, depois com a conta Mestre e depois com a conta de um restaurante.

import { configPreenchida, firebaseConfig, auth, db, FIREBASE_VERSION, MASTER_UID } from "./firebase-config.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDocs, setDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { $, criar, toast, mensagemErroFirebase } from "./utils.js";

const lista = $("#lista");
let rodada = 0;

function mostrar(nome, estado, detalhe) {
  const selo = estado === "ok" ? ["selo-ok", "OK"] : estado === "aviso" ? ["selo-aviso", "ATENÇÃO"] : ["selo-erro", "FALHA"];
  lista.append(criar("div", { class: "teste" },
    criar("div", {}, criar("strong", { texto: nome }), criar("small", { texto: detalhe || "" })),
    criar("span", { class: `selo ${selo[0]}`, texto: selo[1] })
  ));
}

// A operação TEM que ser negada pelas regras
async function exigirNegado(nome, operacao, detalheOk) {
  try {
    await operacao();
    mostrar(nome, "erro", "As regras PERMITIRAM esta operação. Revise o firestore.rules publicado.");
  } catch (erro) {
    if (erro.code === "permission-denied") mostrar(nome, "ok", detalheOk);
    else mostrar(nome, "aviso", mensagemErroFirebase(erro));
  }
}

// A operação TEM que ser permitida
async function exigirPermitido(nome, operacao, detalheOk) {
  try {
    await operacao();
    mostrar(nome, "ok", detalheOk);
  } catch (erro) {
    mostrar(nome, "erro", mensagemErroFirebase(erro));
  }
}

async function rodarTestes() {
  const minha = ++rodada;
  lista.replaceChildren();
  if (!configPreenchida) {
    mostrar("Configuração Firebase", "erro", "Preencha os dados em js/firebase-config.js.");
    return;
  }
  mostrar("Configuração Firebase", "ok", `Projeto ${firebaseConfig.projectId} · SDK ${FIREBASE_VERSION}`);

  const usuario = auth.currentUser;
  const gravarDiagnostico = () => setDoc(doc(db, "_diagnostico", "teste"), { criadoEm: serverTimestamp() });
  const listarRestaurantes = () => getDocs(collection(db, "restaurantes"));
  const indiceDeOutraConta = () => getDocs(collection(db, "usuarios", "uid-de-outra-conta", "restaurantes"));

  if (!usuario) {
    await exigirNegado("Sem login: gravar", gravarDiagnostico, "Gravação anônima negada, como esperado.");
    await exigirNegado("Sem login: listar restaurantes", listarRestaurantes, "Lista de restaurantes negada.");
    await exigirNegado("Sem login: ler vínculos de outra conta", indiceDeOutraConta, "Leitura negada.");
    if (minha === rodada) mostrar("Contas autorizadas", "aviso", "Entre abaixo com a conta Mestre e depois com a de um restaurante para testar o resto.");
    return;
  }

  if (usuario.uid === MASTER_UID) {
    await exigirPermitido("Mestre: gravar diagnóstico", async () => {
      await gravarDiagnostico();
      await deleteDoc(doc(db, "_diagnostico", "teste"));
    }, "Gravou e removeu o documento temporário.");
    await exigirPermitido("Mestre: listar restaurantes", listarRestaurantes, "Lista de restaurantes permitida.");
    return;
  }

  // Conta de restaurante (ou qualquer conta comum): não pode sair do próprio restaurante
  mostrar("Conta conectada", "ok", "Não é a conta Mestre: testando o isolamento.");
  await exigirNegado("Restaurante: gravar diagnóstico", gravarDiagnostico, "Só o Mestre grava aqui.");
  await exigirNegado("Restaurante: listar todos os restaurantes", listarRestaurantes, "Só o Mestre lista a plataforma.");
  await exigirNegado("Restaurante: ler vínculos de outra conta", indiceDeOutraConta, "Cada conta só lê o próprio índice.");
  await exigirPermitido("Restaurante: ler o próprio índice",
    () => getDocs(collection(db, "usuarios", usuario.uid, "restaurantes")), "Leitura do próprio índice permitida.");
}

$("#btnEntrar").addEventListener("click", async () => {
  if (!$("#email").value.trim() || !$("#senha").value) return toast("Informe e-mail e senha.", "aviso");
  try {
    await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#senha").value);
    $("#senha").value = "";
    toast("Login realizado.", "sucesso");
  } catch (erro) {
    toast(mensagemErroFirebase(erro), "erro");
  }
});
$("#btnSair").addEventListener("click", () => signOut(auth));
$("#btnRodar").addEventListener("click", rodarTestes);

onAuthStateChanged(auth, (user) => {
  $("#areaLogin").classList.toggle("oculto", !!user);
  $("#areaLogado").classList.toggle("oculto", !user);
  if (user) {
    $("#usuarioEmail").textContent = user.email || "(sem e-mail)";
    $("#usuarioUid").textContent = user.uid;
  }
  rodarTestes();
});
