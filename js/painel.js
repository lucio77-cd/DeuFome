// Deu Fome — painel do restaurante (Etapa 1)
// Dados isolados em restaurantes/{restauranteId}. Quem protege os dados é o firestore.rules;
// aqui ficam as validações de tela e o cuidado para nunca misturar dados de dois restaurantes.

import { auth, db } from "./firebase-config.js";
import { $, criar, botaoDe, executar, mensagemErroFirebase, paraCentavos, centavosParaTexto, formatarMoeda, toast } from "./utils.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Mesmos tetos do firestore.rules (em centavos)
const PRECO_MAXIMO = 1000000; // R$ 10.000,00
const TAXA_MAXIMA = 100000;   // R$ 1.000,00

let carga = 0;          // muda a cada login/logout/troca de restaurante: respostas antigas são descartadas
let restauranteId = "";
let restaurantes = [];  // [{ id, nome }]
let categorias = [];
let produtos = [];

// ---------- Utilitários de tela ----------
// Enquanto carrega, o conteúdo fica bloqueado: ninguém salva com dados de outro restaurante na tela
function ocupado(ligado) {
  const area = $("#conteudo");
  area.inert = ligado;
  area.classList.toggle("carregando", ligado);
  area.setAttribute("aria-busy", String(ligado));
}

function mostrarConteudo(visivel) {
  $("#conteudo").classList.toggle("oculto", !visivel);
}

function caminho(id, nomeColecao) {
  return collection(db, "restaurantes", id, nomeColecao);
}

function limparDados() {
  categorias = [];
  produtos = [];
  $("#listaCategorias").replaceChildren();
  $("#listaProdutos").replaceChildren();
  $("#configForm").reset();
  $("#categoriaForm").reset();
  limparProdutoForm();
  $("#dicaHorario").textContent = "";
  $("#tituloRestaurante").textContent = "Seu estabelecimento";
}

function limparTela() {
  restauranteId = "";
  restaurantes = [];
  limparDados();
  $("#seletorRestaurante").replaceChildren();
  $("#seletorArea").classList.add("oculto");
  $("#semVinculo").classList.add("oculto");
  $("#erroCarga").classList.add("oculto");
  mostrarConteudo(false);
}

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

onAuthStateChanged(auth, async (user) => {
  const minha = ++carga;
  limparTela(); // troca de conta ou logout: nada da conta anterior pode ficar na tela
  $("#loginCard").classList.toggle("oculto", !!user);
  $("#app").classList.toggle("oculto", !user);
  if (!user) return;
  await carregarVinculos(user.uid, minha);
});

// ---------- Restaurantes vinculados à conta ----------
async function carregarVinculos(uid, minha) {
  $("#erroCarga").classList.add("oculto");
  try {
    const indice = await getDocs(collection(db, "usuarios", uid, "restaurantes"));
    const ids = indice.docs.filter((item) => item.data().ativo !== false).map((item) => item.id);
    // O nome vem do próprio restaurante (o índice guarda só uma cópia que pode ficar velha).
    // Restaurante desativado nega a leitura (permission-denied) e simplesmente sai da lista.
    const leituras = await Promise.allSettled(ids.map((id) => getDoc(doc(db, "restaurantes", id))));
    if (minha !== carga) return;

    const falha = leituras.find((r) => r.status === "rejected" && r.reason?.code !== "permission-denied");
    if (falha) throw falha.reason;

    restaurantes = [];
    leituras.forEach((resultado, i) => {
      if (resultado.status === "fulfilled" && resultado.value.exists()) {
        restaurantes.push({ id: ids[i], nome: resultado.value.data().nome || "Restaurante" });
      }
    });

    if (!restaurantes.length) {
      $("#tituloRestaurante").textContent = "Conta ainda não vinculada";
      $("#semVinculo").classList.remove("oculto");
      return;
    }

    montarSeletor(restaurantes[0].id);
    $("#seletorArea").classList.toggle("oculto", restaurantes.length < 2);
    restauranteId = restaurantes[0].id;
    await carregarPainel(minha);
  } catch (erro) {
    if (minha !== carga) return;
    toast(mensagemErroFirebase(erro), "erro");
    $("#erroCarga").classList.remove("oculto");
  }
}

function montarSeletor(selecionadoId) {
  const seletor = $("#seletorRestaurante");
  seletor.replaceChildren(...restaurantes.map((item) => criar("option", { value: item.id, texto: item.nome })));
  seletor.value = selecionadoId;
}

$("#seletorRestaurante").addEventListener("change", async (evento) => {
  const minha = ++carga;
  restauranteId = evento.target.value;
  await carregarPainel(minha);
});

$("#tentarDeNovo").addEventListener("click", () => {
  if (!auth.currentUser) return;
  const minha = ++carga;
  if (restauranteId) carregarPainel(minha);
  else carregarVinculos(auth.currentUser.uid, minha);
});

// ---------- Carga do restaurante selecionado ----------
async function carregarPainel(minha) {
  if (!restauranteId) return;
  const id = restauranteId;
  $("#erroCarga").classList.add("oculto");
  mostrarConteudo(true);
  ocupado(true);
  limparDados(); // some o que era do restaurante anterior antes de qualquer resposta chegar
  try {
    const [restaurante, cats, prods] = await Promise.all([
      getDoc(doc(db, "restaurantes", id)),
      getDocs(caminho(id, "categorias")),
      getDocs(caminho(id, "produtos"))
    ]);
    if (minha !== carga) return; // o usuário já trocou de restaurante ou de conta
    if (!restaurante.exists()) throw new Error("Restaurante não encontrado.");

    const dados = restaurante.data();
    $("#tituloRestaurante").textContent = dados.nome || "Restaurante";
    $("#nomeRestaurante").value = dados.nome || "";
    $("#taxa").value = centavosParaTexto(dados.taxaEntregaCentavos);
    $("#abertura").value = dados.horarioAbertura || "09:00";
    $("#fechamento").value = dados.horarioFechamento || "22:00";
    $("#aberto").checked = dados.aberto === true;
    atualizarDicaHorario();

    categorias = cats.docs.map((item) => ({ id: item.id, ...item.data() }));
    produtos = prods.docs.map((item) => ({ id: item.id, ...item.data() }));
    renderizar();
    ocupado(false);
  } catch (erro) {
    if (minha !== carga) return;
    toast(mensagemErroFirebase(erro), "erro");
    mostrarConteudo(false);
    $("#erroCarga").classList.remove("oculto"); // o conteúdo continua bloqueado até carregar de verdade
  }
}

async function recarregarCardapio() {
  const minha = carga;
  const id = restauranteId;
  const [cats, prods] = await Promise.all([getDocs(caminho(id, "categorias")), getDocs(caminho(id, "produtos"))]);
  if (minha !== carga) return;
  categorias = cats.docs.map((item) => ({ id: item.id, ...item.data() }));
  produtos = prods.docs.map((item) => ({ id: item.id, ...item.data() }));
  renderizar();
}

function renderizar() {
  renderCategorias();
  renderProdutos();
}

// ---------- Configurações ----------
function atualizarDicaHorario() {
  const abre = $("#abertura").value;
  const fecha = $("#fechamento").value;
  $("#dicaHorario").textContent = abre && fecha && fecha < abre ? `Fecha às ${fecha} do dia seguinte.` : "";
}
$("#abertura").addEventListener("input", atualizarDicaHorario);
$("#fechamento").addEventListener("input", atualizarDicaHorario);

$("#configForm").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const id = restauranteId;
  if (!id) return;
  executar(botaoDe(evento), async () => {
    const nome = $("#nomeRestaurante").value.trim();
    const taxa = paraCentavos($("#taxa").value || "0");
    const abertura = $("#abertura").value;
    const fechamento = $("#fechamento").value;
    if (nome.length < 2 || nome.length > 80) throw new Error("O nome precisa ter de 2 a 80 caracteres.");
    if (taxa === null || taxa > TAXA_MAXIMA) throw new Error("Taxa de entrega inválida (de R$ 0,00 a R$ 1.000,00).");
    if (!abertura || !fechamento) throw new Error("Informe o horário de abertura e de fechamento.");
    if (abertura === fechamento) throw new Error("Abertura e fechamento não podem ser iguais.");

    await updateDoc(doc(db, "restaurantes", id), {
      nome,
      taxaEntregaCentavos: taxa,
      horarioAbertura: abertura,
      horarioFechamento: fechamento,
      aberto: $("#aberto").checked,
      atualizadoEm: serverTimestamp()
    });

    if (id === restauranteId) {
      $("#tituloRestaurante").textContent = nome;
      $("#taxa").value = centavosParaTexto(taxa);
      const item = restaurantes.find((r) => r.id === id);
      if (item) {
        item.nome = nome;
        montarSeletor(id);
      }
    }
    toast("Configurações salvas.", "sucesso");
  });
});

// ---------- Categorias ----------
$("#categoriaForm").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const id = restauranteId;
  if (!id) return;
  executar(botaoDe(evento), async () => {
    const nome = $("#categoriaNome").value.trim();
    if (nome.length < 2 || nome.length > 45) throw new Error("O nome da categoria precisa ter de 2 a 45 caracteres.");
    if (categorias.some((cat) => cat.nome.toLocaleLowerCase("pt-BR") === nome.toLocaleLowerCase("pt-BR"))) {
      throw new Error("Já existe uma categoria com esse nome.");
    }
    // max + 1 (e não a quantidade): apagar uma categoria do meio não repete a ordem
    const ordem = categorias.reduce((maior, cat) => Math.max(maior, Number(cat.ordem) || 0), -1) + 1;
    await setDoc(doc(caminho(id, "categorias")), { nome, ativo: true, ordem, criadoEm: serverTimestamp() });
    $("#categoriaNome").value = "";
    await recarregarCardapio();
    toast("Categoria adicionada.", "sucesso");
  });
});

function ordenarCategorias() {
  return [...categorias].sort((a, b) =>
    (Number(a.ordem) || 0) - (Number(b.ordem) || 0) || String(a.nome).localeCompare(String(b.nome), "pt-BR"));
}

function renderCategorias() {
  const area = $("#listaCategorias");
  area.replaceChildren();
  const ordenadas = ordenarCategorias();
  if (!ordenadas.length) {
    area.append(criar("p", { class: "texto-suave", texto: "Cadastre uma categoria para começar." }));
  }
  ordenadas.forEach((cat) => {
    const quantos = produtos.filter((p) => p.categoriaId === cat.id && p.ativo !== false).length;
    area.append(criar("div", { class: "item-lista" },
      criar("div", {}, criar("strong", { texto: cat.nome }),
        criar("small", { texto: quantos === 1 ? "1 produto" : `${quantos} produtos` })),
      criar("button", { class: "btn btn-secundario btn-pequeno", type: "button", texto: "Excluir", "data-id": cat.id })
    ));
  });

  const seletor = $("#produtoCategoria");
  const anterior = seletor.value;
  seletor.replaceChildren(...ordenadas.map((cat) => criar("option", { value: cat.id, texto: cat.nome })));
  if (anterior && ordenadas.some((cat) => cat.id === anterior)) seletor.value = anterior;
  seletor.disabled = !ordenadas.length;
  $("#salvarProduto").disabled = !ordenadas.length;
}

$("#listaCategorias").addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-id]");
  if (!botao) return;
  const id = restauranteId;
  const cat = categorias.find((item) => item.id === botao.dataset.id);
  if (!id || !cat) return;
  // Conta também os arquivados: um produto arquivado ainda aponta para a categoria
  const vinculados = produtos.filter((produto) => produto.categoriaId === cat.id).length;
  if (vinculados) {
    toast(`Não dá para excluir "${cat.nome}": há ${vinculados} produto(s) nela (incluindo arquivados).`, "aviso");
    return;
  }
  if (!confirm(`Excluir a categoria "${cat.nome}"?`)) return;
  executar(botao, async () => {
    await deleteDoc(doc(db, "restaurantes", id, "categorias", cat.id));
    await recarregarCardapio();
    toast("Categoria excluída.", "sucesso");
  });
});

// ---------- Produtos ----------
function limparProdutoForm() {
  $("#produtoForm").reset();
  $("#produtoId").value = "";
  $("#produtoDisponivel").checked = true;
  $("#salvarProduto").textContent = "Salvar produto";
  $("#cancelarEdicao").classList.add("oculto");
}

$("#produtoForm").addEventListener("submit", (evento) => {
  evento.preventDefault();
  const id = restauranteId;
  if (!id) return;
  executar(botaoDe(evento), async () => {
    const produtoId = $("#produtoId").value;
    const nome = $("#produtoNome").value.trim();
    const descricao = $("#produtoDescricao").value.trim();
    const categoriaId = $("#produtoCategoria").value;
    const precoCentavos = paraCentavos($("#produtoPreco").value);

    if (nome.length < 1 || nome.length > 80) throw new Error("O nome do produto precisa ter de 1 a 80 caracteres.");
    if (descricao.length > 240) throw new Error("A descrição pode ter no máximo 240 caracteres.");
    if (!categoriaId || !categorias.some((cat) => cat.id === categoriaId)) throw new Error("Escolha uma categoria.");
    if (precoCentavos === null || precoCentavos <= 0 || precoCentavos > PRECO_MAXIMO) {
      throw new Error("Preço inválido (de R$ 0,01 a R$ 10.000,00).");
    }

    const dados = {
      nome, descricao, precoCentavos, categoriaId,
      disponivel: $("#produtoDisponivel").checked,
      ativo: true,
      atualizadoEm: serverTimestamp()
    };
    if (produtoId) {
      await updateDoc(doc(db, "restaurantes", id, "produtos", produtoId), dados);
    } else {
      await setDoc(doc(caminho(id, "produtos")), { ...dados, criadoEm: serverTimestamp() });
    }
    limparProdutoForm();
    await recarregarCardapio();
    toast(produtoId ? "Produto atualizado." : "Produto cadastrado.", "sucesso");
  });
});

function botaoAcao(rotulo, acao, produtoId) {
  return criar("button", {
    class: "btn btn-secundario btn-pequeno", type: "button", texto: rotulo,
    "data-acao": acao, "data-id": produtoId
  });
}

function renderProdutos() {
  const area = $("#listaProdutos");
  area.replaceChildren();

  const ativos = produtos.filter((p) => p.ativo !== false);
  const arquivados = produtos.filter((p) => p.ativo === false);
  $("#rotuloArquivados").textContent = `Mostrar arquivados (${arquivados.length})`;
  $("#blocoArquivados").classList.toggle("oculto", !arquivados.length);

  const ordemCategoria = new Map(ordenarCategorias().map((cat, i) => [cat.id, i]));
  const ordenar = (lista) => [...lista].sort((a, b) =>
    (ordemCategoria.get(a.categoriaId) ?? 999) - (ordemCategoria.get(b.categoriaId) ?? 999)
    || String(a.nome).localeCompare(String(b.nome), "pt-BR"));

  const visiveis = $("#mostrarArquivados").checked && arquivados.length
    ? [...ordenar(ativos), ...ordenar(arquivados)]
    : ordenar(ativos);

  if (!visiveis.length) {
    area.append(criar("p", { class: "texto-suave", texto: "Nenhum produto cadastrado." }));
    return;
  }

  visiveis.forEach((produto) => {
    const arquivado = produto.ativo === false;
    const cat = categorias.find((item) => item.id === produto.categoriaId);
    const titulo = criar("strong", { texto: produto.nome });
    const selos = [];
    if (arquivado) selos.push(criar("span", { class: "selo", texto: "Arquivado" }));
    else if (produto.disponivel === false) selos.push(criar("span", { class: "selo selo-aviso", texto: "Indisponível" }));

    const acoes = arquivado
      ? [botaoAcao("Restaurar", "restaurar", produto.id)]
      : [
          botaoAcao("Editar", "editar", produto.id),
          botaoAcao(produto.disponivel === false ? "Retomar" : "Pausar", "alternar", produto.id),
          botaoAcao("Arquivar", "arquivar", produto.id)
        ];

    area.append(criar("article", { class: "item-lista produto-linha" },
      criar("div", {}, titulo, " ", ...selos,
        criar("small", { texto: `${cat ? cat.nome : "Sem categoria"} · ${formatarMoeda(produto.precoCentavos)}` })),
      criar("div", { class: "acoes-item" }, ...acoes)
    ));
  });
}

$("#mostrarArquivados").addEventListener("change", renderProdutos);

function editarProduto(produto) {
  $("#produtoId").value = produto.id;
  $("#produtoNome").value = produto.nome || "";
  $("#produtoDescricao").value = produto.descricao || "";
  $("#produtoPreco").value = centavosParaTexto(produto.precoCentavos);
  $("#produtoCategoria").value = produto.categoriaId || "";
  $("#produtoDisponivel").checked = produto.disponivel !== false;
  $("#salvarProduto").textContent = "Salvar alterações";
  $("#cancelarEdicao").classList.remove("oculto");
  $("#produtoNome").focus();
}

$("#cancelarEdicao").addEventListener("click", limparProdutoForm);

$("#listaProdutos").addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-acao]");
  if (!botao) return;
  const id = restauranteId;
  const produto = produtos.find((item) => item.id === botao.dataset.id);
  if (!id || !produto) return;
  const acao = botao.dataset.acao;

  if (acao === "editar") return editarProduto(produto);
  if (acao === "arquivar" && !confirm(`Arquivar "${produto.nome}"? Ele sai do cardápio, mas o histórico é mantido.`)) return;

  executar(botao, async () => {
    let mudancas;
    if (acao === "arquivar") mudancas = { ativo: false, disponivel: false };
    else if (acao === "restaurar") mudancas = { ativo: true };
    else mudancas = { disponivel: produto.disponivel === false }; // pausar / retomar
    // "ativo" vai sempre junto: produtos antigos não tinham o campo e as regras exigem
    await updateDoc(doc(db, "restaurantes", id, "produtos", produto.id), {
      ativo: produto.ativo !== false, ...mudancas, atualizadoEm: serverTimestamp()
    });
    if (acao === "arquivar" && $("#produtoId").value === produto.id) limparProdutoForm();
    await recarregarCardapio();
    toast(
      acao === "arquivar" ? "Produto arquivado." : acao === "restaurar" ? "Produto restaurado." :
      mudancas.disponivel ? "Produto disponível de novo." : "Produto pausado.",
      "sucesso"
    );
  });
});
