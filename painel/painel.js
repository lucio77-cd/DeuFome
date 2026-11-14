import { auth, db } from "../js/firebase-config.js";
import { $, mensagemErroFirebase, escapeHtml, paraCentavos, formatarMoeda, toast } from "../js/utils.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let restaurantes = [];
let restauranteId = "";
let categorias = [];
let produtos = [];

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#loginErro").textContent = "";
  try { await signInWithEmailAndPassword(auth, $("#email").value.trim(), $("#senha").value); }
  catch (error) { $("#loginErro").textContent = mensagemErroFirebase(error); }
});
$("#sair").addEventListener("click", () => signOut(auth));
$("#seletorRestaurante").addEventListener("change", async (event) => {
  restauranteId = event.target.value;
  await carregarPainel();
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    $("#loginCard").classList.remove("oculto");
    $("#app").classList.add("oculto");
    restaurantes = [];
    restauranteId = "";
    return;
  }
  $("#loginCard").classList.add("oculto");
  $("#app").classList.remove("oculto");
  await carregarVinculos(user.uid);
});

async function carregarVinculos(uid) {
  try {
    $("#configForm").classList.remove("oculto");
    $("#categoriaForm").classList.remove("oculto");
    $("#produtoForm").classList.remove("oculto");
    const snap = await getDocs(collection(db, "usuarios", uid, "restaurantes"));
    restaurantes = snap.docs.map((item) => ({ id: item.id, ...item.data() })).filter((item) => item.ativo !== false);
    if (!restaurantes.length) {
      const avisoExistente = $("#semVinculo");
      if (avisoExistente) avisoExistente.remove();
      $("#tituloRestaurante").textContent = "Conta ainda não vinculada";
      $("#seletorArea").classList.add("oculto");
      $("#configForm").classList.add("oculto");
      $("#categoriaForm").classList.add("oculto");
      $("#produtoForm").classList.add("oculto");
      $("#app").insertAdjacentHTML("afterbegin", "<section id='semVinculo' class='card mensagem aviso'>Peça ao Mestre para vincular seu usuário a um restaurante.</section>");
      return;
    }
    const aviso = $("#semVinculo");
    if (aviso) aviso.remove();
    $("#configForm").classList.remove("oculto");
    $("#categoriaForm").classList.remove("oculto");
    $("#produtoForm").classList.remove("oculto");
    $("#seletorArea").classList.toggle("oculto", restaurantes.length < 2);
    $("#seletorRestaurante").innerHTML = restaurantes.map((item) =>
      "<option value='" + escapeHtml(item.id) + "'>" + escapeHtml(item.nome || "Restaurante") + "</option>"
    ).join("");
    restauranteId = restaurantes[0].id;
    await carregarPainel();
  } catch (error) { toast(mensagemErroFirebase(error), "erro"); }
}

function caminho(nomeColecao) {
  return collection(db, "restaurantes", restauranteId, nomeColecao);
}

async function carregarPainel() {
  if (!restauranteId) return;
  try {
    const resultados = await Promise.all([
      getDoc(doc(db, "restaurantes", restauranteId)),
      getDocs(caminho("categorias")),
      getDocs(caminho("produtos"))
    ]);
    const restSnap = resultados[0];
    if (!restSnap.exists()) throw new Error("Restaurante não encontrado.");
    const dados = restSnap.data();
    $("#tituloRestaurante").textContent = dados.nome || "Restaurante";
    $("#nomeRestaurante").value = dados.nome || "";
    $("#taxa").value = (Number(dados.taxaEntregaCentavos || 0) / 100).toFixed(2).replace(".", ",");
    $("#abertura").value = dados.horarioAbertura || "09:00";
    $("#fechamento").value = dados.horarioFechamento || "22:00";
    $("#aberto").checked = dados.aberto === true;
    categorias = resultados[1].docs.map((item) => ({ id: item.id, ...item.data() }));
    produtos = resultados[2].docs.map((item) => ({ id: item.id, ...item.data() }));
    renderCategorias();
    renderProdutos();
  } catch (error) { toast(mensagemErroFirebase(error), "erro"); }
}

$("#configForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const nome = $("#nomeRestaurante").value.trim();
    const taxaCentavos = paraCentavos($("#taxa").value);
    if (nome.length < 2) throw new Error("Informe um nome válido.");
    await updateDoc(doc(db, "restaurantes", restauranteId), {
      nome, taxaEntregaCentavos: taxaCentavos,
      horarioAbertura: $("#abertura").value, horarioFechamento: $("#fechamento").value,
      aberto: $("#aberto").checked, atualizadoEm: serverTimestamp()
    });
    $("#tituloRestaurante").textContent = nome;
    toast("Configurações salvas.", "sucesso");
  } catch (error) { toast(mensagemErroFirebase(error), "erro"); }
});

$("#categoriaForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const nome = $("#categoriaNome").value.trim();
  if (nome.length < 2) return toast("Digite um nome de categoria.", "aviso");
  try {
    await setDoc(doc(caminho("categorias")), { nome, ativo: true, ordem: categorias.length, criadoEm: serverTimestamp() });
    $("#categoriaNome").value = "";
    await carregarPainel();
    toast("Categoria adicionada.", "sucesso");
  } catch (error) { toast(mensagemErroFirebase(error), "erro"); }
});

function renderCategorias() {
  const area = $("#listaCategorias");
  area.innerHTML = "";
  if (!categorias.length) area.innerHTML = "<p class='texto-suave'>Cadastre uma categoria para começar.</p>";
  categorias.sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0)).forEach((cat) => {
    const row = document.createElement("div");
    row.className = "item-lista";
    row.innerHTML = "<strong>" + escapeHtml(cat.nome) + "</strong><button class='btn btn-secundario btn-pequeno' type='button' data-excluir-categoria='" + escapeHtml(cat.id) + "'>Excluir</button>";
    area.appendChild(row);
  });
  $("#produtoCategoria").innerHTML = categorias.map((cat) =>
    "<option value='" + escapeHtml(cat.id) + "'>" + escapeHtml(cat.nome) + "</option>"
  ).join("");
  $("#produtoCategoria").disabled = !categorias.length;
  $("#salvarProduto").disabled = !categorias.length;
}

$("#listaCategorias").addEventListener("click", async (event) => {
  const id = event.target.dataset.excluirCategoria;
  if (!id) return;
  if (produtos.some((produto) => produto.categoriaId === id)) return toast("Não é possível excluir: há produtos nesta categoria.", "aviso");
  if (!confirm("Excluir esta categoria?")) return;
  try {
    await deleteDoc(doc(db, "restaurantes", restauranteId, "categorias", id));
    await carregarPainel();
    toast("Categoria excluída.", "sucesso");
  } catch (error) { toast(mensagemErroFirebase(error), "erro"); }
});

$("#produtoForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#produtoId").value;
  const nome = $("#produtoNome").value.trim();
  const precoCentavos = paraCentavos($("#produtoPreco").value);
  const categoriaId = $("#produtoCategoria").value;
  if (!nome || !categoriaId || precoCentavos <= 0) return toast("Informe nome, categoria e preço maior que zero.", "aviso");
  const dados = {
    nome, descricao: $("#produtoDescricao").value.trim(), precoCentavos, categoriaId,
    disponivel: $("#produtoDisponivel").checked, atualizadoEm: serverTimestamp()
  };
  try {
    if (id) await updateDoc(doc(db, "restaurantes", restauranteId, "produtos", id), dados);
    else {
      dados.criadoEm = serverTimestamp();
      await setDoc(doc(caminho("produtos")), dados);
    }
    limparProdutoForm();
    await carregarPainel();
    toast(id ? "Produto atualizado." : "Produto cadastrado.", "sucesso");
  } catch (error) { toast(mensagemErroFirebase(error), "erro"); }
});

function renderProdutos() {
  const area = $("#listaProdutos");
  area.innerHTML = "";
  if (!produtos.length) {
    area.innerHTML = "<p class='texto-suave'>Nenhum produto cadastrado.</p>";
    return;
  }
  produtos.sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR")).forEach((produto) => {
    const cat = categorias.find((item) => item.id === produto.categoriaId);
    const row = document.createElement("article");
    row.className = "item-lista produto-linha";
    row.innerHTML = "<div><strong>" + escapeHtml(produto.nome) + "</strong><small>" +
      escapeHtml(cat ? cat.nome : "Sem categoria") + " · " + escapeHtml(formatarMoeda(produto.precoCentavos)) +
      " · " + (produto.disponivel ? "Disponível" : "Indisponível") + "</small></div>" +
      "<div class='acoes-item'><button class='btn btn-secundario btn-pequeno' type='button' data-editar='" + escapeHtml(produto.id) + "'>Editar</button>" +
      "<button class='btn btn-secundario btn-pequeno' type='button' data-excluir='" + escapeHtml(produto.id) + "'>Excluir</button></div>";
    area.appendChild(row);
  });
}

$("#listaProdutos").addEventListener("click", async (event) => {
  const editarId = event.target.dataset.editar;
  const excluirId = event.target.dataset.excluir;
  if (editarId) {
    const item = produtos.find((produto) => produto.id === editarId);
    if (!item) return;
    $("#produtoId").value = item.id;
    $("#produtoNome").value = item.nome || "";
    $("#produtoDescricao").value = item.descricao || "";
    $("#produtoPreco").value = (Number(item.precoCentavos || 0) / 100).toFixed(2).replace(".", ",");
    $("#produtoCategoria").value = item.categoriaId || "";
    $("#produtoDisponivel").checked = item.disponivel !== false;
    $("#salvarProduto").textContent = "Salvar alterações";
    $("#cancelarEdicao").classList.remove("oculto");
    $("#produtoNome").focus();
  }
  if (excluirId) {
    if (!confirm("Excluir este produto?")) return;
    try {
      await deleteDoc(doc(db, "restaurantes", restauranteId, "produtos", excluirId));
      await carregarPainel();
      toast("Produto excluído.", "sucesso");
    } catch (error) { toast(mensagemErroFirebase(error), "erro"); }
  }
});
$("#cancelarEdicao").addEventListener("click", limparProdutoForm);

function limparProdutoForm() {
  $("#produtoForm").reset();
  $("#produtoId").value = "";
  $("#produtoDisponivel").checked = true;
  $("#salvarProduto").textContent = "Salvar produto";
  $("#cancelarEdicao").classList.add("oculto");
}
