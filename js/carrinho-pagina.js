// Deu Fome — carrinho e finalização do pedido (Etapa 3)
// O navegador envia só IDs e quantidades; o servidor (/api/criar-pedido) calcula preço e total.
import { db } from "./firebase-config.js";
import { $, criar, formatarMoeda, formatarTelefone, soDigitos, paraCentavos, telefoneValido, botaoDe, executar, mensagemErroFirebase } from "./utils.js";
import { statusRestaurante } from "./cliente.js";
import {
  lerCarrinho, alterarQuantidade, removerItem, limparCarrinho, substituirItens,
  subtotalCentavos, lerCliente, salvarCliente, novoPedidoId
} from "./carrinho.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const avisos = $("#avisos");
let restaurante = null;      // dados do restaurante (com id) para taxa e horário
let totalAtual = 0;          // total mostrado na tela (confirmado pelo servidor ao enviar)
let pedidoIdPendente = null; // mesmo código em reenvios após falha de rede (evita pedido duplicado)
let impressaoPendente = ""; // "foto" dos dados enviados com esse código: se mudarem, o reenvio é um pedido novo
// Cupom aplicado: { codigo, subtotalCentavos (do carrinho quando foi conferido), descontoCentavos, taxaCentavos }.
// O desconto vem do SERVIDOR (/api/validar-cupom) e é conferido de novo ao enviar o pedido.
let cupom = null;
let versaoCupom = 0;         // descarta respostas antigas da conferência de cupom

function mostrarAviso(texto, tipo = "aviso") {
  avisos.replaceChildren(criar("p", { class: `mensagem ${tipo}`, texto }));
}

function mostrarVazio() {
  $("#conteudo").classList.add("oculto");
  $("#vazio").classList.remove("oculto");
}

// Desenha lista, totais e aviso de restaurante fechado a partir do carrinho guardado
function desenhar() {
  const carrinho = lerCarrinho();
  if (!carrinho.itens.length || !restaurante) return mostrarVazio();

  $("#vazio").classList.add("oculto");
  $("#conteudo").classList.remove("oculto");
  $("#nomeRestaurante").textContent = restaurante.nome;
  $("#voltar").href = `/restaurante?r=${encodeURIComponent(carrinho.restauranteId)}`;

  $("#listaItens").replaceChildren(...carrinho.itens.map((i) => criar("div", { class: "item-carrinho" },
    criar("div", { class: "item-carrinho-info" },
      criar("strong", { texto: i.nome }),
      criar("small", { texto: `${formatarMoeda(i.precoCentavos)} cada` })),
    criar("div", { class: "quantidade" },
      criar("button", {
        class: "btn btn-secundario", type: "button", title: i.quantidade === 1 ? "Remover" : "Diminuir",
        texto: i.quantidade === 1 ? "🗑" : "−", "data-acao": i.quantidade === 1 ? "remover" : "menos", "data-id": i.produtoId
      }),
      criar("span", { texto: String(i.quantidade) }),
      criar("button", { class: "btn btn-secundario", type: "button", title: "Aumentar", texto: "+", "data-acao": "mais", "data-id": i.produtoId })),
    criar("strong", { texto: formatarMoeda(i.precoCentavos * i.quantidade) })
  )));

  const subtotal = subtotalCentavos(carrinho);
  const taxaBase = Number(restaurante.taxaEntregaCentavos || 0);
  // O desconto de porcentagem depende do subtotal: se o carrinho mudou, tira o desconto e confere de novo
  if (cupom && cupom.subtotalCentavos !== subtotal) {
    const codigo = cupom.codigo;
    cupom = null;
    conferirCupom(codigo);
  }
  const desconto = cupom ? cupom.descontoCentavos : 0;
  const taxa = cupom ? cupom.taxaCentavos : taxaBase;
  totalAtual = subtotal - desconto + taxa;
  $("#subtotal").textContent = formatarMoeda(subtotal);
  $("#linhaDesconto").classList.toggle("oculto", !(cupom && desconto > 0));
  if (cupom && desconto > 0) {
    $("#rotuloDesconto").textContent = `Desconto (${cupom.codigo})`;
    $("#valorDesconto").textContent = `− ${formatarMoeda(desconto)}`;
  }
  $("#taxa").textContent = taxa > 0 ? formatarMoeda(taxa) : (cupom && taxaBase > 0 ? `Grátis (${cupom.codigo})` : "Grátis");
  $("#total").textContent = formatarMoeda(totalAtual);
  $("#aplicarCupom").textContent = cupom ? "Remover" : "Aplicar";

  const status = statusRestaurante(restaurante);
  const avisoStatus = $("#avisoStatus");
  avisoStatus.textContent = status.aberto ? "" : `Este restaurante está fechado agora. ${status.detalhe} Você só consegue enviar o pedido quando ele abrir.`;
  avisoStatus.classList.toggle("oculto", status.aberto);
}

// Busca restaurante e cardápio atuais: atualiza preços, tira itens indisponíveis e avisa o cliente
async function atualizarDoServidor() {
  const carrinho = lerCarrinho();
  if (!carrinho.itens.length) {
    restaurante = null;
    return mostrarVazio();
  }
  try {
    const ref = doc(db, "restaurantes", carrinho.restauranteId);
    let snapshot = null;
    try {
      snapshot = await getDoc(ref);
    } catch (erro) {
      if (!erro || erro.code !== "permission-denied") throw erro;
    }
    if (!snapshot || !snapshot.exists() || snapshot.data().ativo !== true) {
      limparCarrinho();
      restaurante = null;
      mostrarVazio();
      return mostrarAviso("Este restaurante não está mais disponível. Seu carrinho foi esvaziado.", "erro");
    }

    const [cats, prods] = await Promise.all([
      getDocs(query(collection(ref, "categorias"), where("ativo", "==", true))),
      getDocs(query(collection(ref, "produtos"), where("ativo", "==", true)))
    ]);
    const categoriasAtivas = new Set(cats.docs.map((d) => d.id));
    const atuais = new Map(prods.docs
      .filter((d) => categoriasAtivas.has(d.data().categoriaId))
      .map((d) => [d.id, d.data()]));

    const itens = [];
    const removidos = [];
    let precoMudou = false;
    for (const item of carrinho.itens) {
      const p = atuais.get(item.produtoId);
      if (!p || p.disponivel !== true) { // igual ao servidor: só "disponivel: true" vale
        removidos.push(item.nome);
        continue;
      }
      if (p.precoCentavos !== item.precoCentavos) precoMudou = true;
      itens.push({ produtoId: item.produtoId, nome: p.nome, precoCentavos: p.precoCentavos, quantidade: item.quantidade });
    }
    substituirItens(itens);

    const mensagens = [];
    if (removidos.length) mensagens.push(`Saíram do carrinho por não estarem mais disponíveis: ${removidos.join(", ")}.`);
    if (precoMudou) mensagens.push("Alguns preços mudaram. Confira o total.");
    if (mensagens.length) mostrarAviso(mensagens.join(" "));

    restaurante = { ...snapshot.data(), id: carrinho.restauranteId };
    desenhar();
  } catch (erro) {
    mostrarAviso(mensagemErroFirebase(erro), "erro");
  }
}

// ---------- Cupom ----------
function mensagemCupom(texto, tipo = "") {
  const el = $("#cupomMsg");
  el.textContent = texto;
  el.className = `mensagem ${tipo}`.trim();
}

// Pergunta ao servidor se o cupom vale para este carrinho e quanto desconta
async function conferirCupom(codigoDigitado) {
  const carrinho = lerCarrinho();
  if (!restaurante || !carrinho.itens.length) return;
  const subtotalNoEnvio = subtotalCentavos(carrinho);
  const minhaVersao = ++versaoCupom;
  mensagemCupom("Conferindo o cupom...");
  let resposta;
  try {
    resposta = await fetch("/api/validar-cupom", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restauranteId: carrinho.restauranteId,
        codigo: codigoDigitado,
        itens: carrinho.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade }))
      })
    });
  } catch (erro) {
    if (minhaVersao === versaoCupom) mensagemCupom("Sem conexão. Verifique a internet e tente de novo.", "erro");
    return;
  }
  let dados = {};
  try { dados = await resposta.json(); } catch (erro) { /* resposta sem JSON */ }
  if (minhaVersao !== versaoCupom) return; // chegou depois de o carrinho ou o cupom mudarem

  if (!resposta.ok) {
    const tinha = cupom !== null;
    cupom = null;
    pedidoIdPendente = null;
    desenhar();
    mensagemCupom(`${tinha ? "Cupom removido: " : ""}${dados.erro || "Não foi possível conferir o cupom."}`, "erro");
    if (dados.codigo === "produto_indisponivel") atualizarDoServidor();
    return;
  }
  cupom = {
    codigo: dados.codigo, subtotalCentavos: subtotalNoEnvio,
    descontoCentavos: Number(dados.descontoCentavos) || 0, taxaCentavos: Number(dados.taxaCentavos) || 0
  };
  pedidoIdPendente = null; // total mudou: é um pedido novo
  $("#cupomCodigo").value = dados.codigo;
  desenhar();
  mensagemCupom(`Cupom ${dados.codigo} aplicado.`, "sucesso");
}

$("#cupomCodigo").addEventListener("input", (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); });
$("#cupomCodigo").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); $("#aplicarCupom").click(); }
});
$("#aplicarCupom").addEventListener("click", () => {
  if (cupom) {
    cupom = null;
    versaoCupom++;
    pedidoIdPendente = null;
    $("#cupomCodigo").value = "";
    mensagemCupom("");
    return desenhar();
  }
  const codigo = $("#cupomCodigo").value.trim();
  if (codigo.length < 3) return mensagemCupom("Digite o código do cupom.", "erro");
  executar($("#aplicarCupom"), () => conferirCupom(codigo));
});

// Botões + / − / lixeira
$("#listaItens").addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-acao]");
  if (!botao) return;
  pedidoIdPendente = null; // carrinho mudou: é um pedido novo
  const id = botao.dataset.id;
  if (botao.dataset.acao === "mais") alterarQuantidade(id, 1);
  else if (botao.dataset.acao === "menos") alterarQuantidade(id, -1);
  else removerItem(id);
  desenhar();
});

// Formulário
const salvo = lerCliente();
$("#nome").value = salvo.nome;
$("#telefone").value = formatarTelefone(salvo.telefone);
$("#endereco").value = salvo.endereco;
$("#referencia").value = salvo.referencia;
$("#telefone").addEventListener("input", (evento) => { evento.target.value = formatarTelefone(evento.target.value); });
$("#pagamento").addEventListener("change", () => {
  $("#blocoTroco").classList.toggle("oculto", $("#pagamento").value !== "dinheiro");
});

function erroNoFormulario(texto) {
  $("#msg").textContent = texto;
}

async function enviar() {
  erroNoFormulario("");
  avisos.replaceChildren();
  const carrinho = lerCarrinho();
  if (!restaurante || !carrinho.itens.length) return;
  if (!statusRestaurante(restaurante).aberto) return erroNoFormulario("O restaurante está fechado no momento.");

  const nome = $("#nome").value.trim();
  const telefone = soDigitos($("#telefone").value);
  const endereco = $("#endereco").value.trim();
  const referencia = $("#referencia").value.trim();
  const observacao = $("#observacao").value.trim();
  const forma = $("#pagamento").value;
  if (nome.length < 2) return erroNoFormulario("Informe seu nome.");
  if (!telefoneValido(telefone)) return erroNoFormulario("Telefone inválido. Informe o DDD e o número.");
  if (endereco.length < 5) return erroNoFormulario("Informe o endereço de entrega.");

  let trocoParaCentavos = null;
  if (forma === "dinheiro" && $("#trocoPara").value.trim()) {
    trocoParaCentavos = paraCentavos($("#trocoPara").value);
    if (trocoParaCentavos === null || trocoParaCentavos <= 0) return erroNoFormulario("Valor do troco inválido. Exemplo: 50,00.");
    if (trocoParaCentavos < totalAtual) return erroNoFormulario(`O troco precisa ser para ${formatarMoeda(totalAtual)} ou mais.`);
  }

  // Reenvio após falha de rede reaproveita o código (não duplica). Mas se o cliente CORRIGIU algum dado
  // (endereço, pagamento, troco, cupom...), o servidor devolveria o pedido antigo com os dados velhos:
  // por isso, dado diferente = código novo.
  const impressao = JSON.stringify([
    carrinho.restauranteId, carrinho.itens.map((i) => [i.produtoId, i.quantidade]),
    nome, telefone, endereco, referencia, observacao, forma, trocoParaCentavos, cupom ? cupom.codigo : "", totalAtual
  ]);
  if (!pedidoIdPendente || impressao !== impressaoPendente) {
    pedidoIdPendente = novoPedidoId();
    impressaoPendente = impressao;
  }

  let resposta;
  try {
    resposta = await fetch("/api/criar-pedido", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chave: pedidoIdPendente, // só evita duplicar no reenvio; o código do pedido vem do servidor na resposta
        restauranteId: carrinho.restauranteId,
        itens: carrinho.itens.map((i) => ({ produtoId: i.produtoId, quantidade: i.quantidade })),
        cliente: { nome, telefone },
        entrega: { endereco, referencia },
        observacao,
        pagamento: { forma, trocoParaCentavos },
        cupom: cupom ? cupom.codigo : undefined, // o servidor confere o cupom e calcula o desconto de novo
        totalEsperadoCentavos: totalAtual
      })
    });
  } catch (erro) {
    // Sem resposta: não sabemos se o pedido chegou. Mantém o código: reenviar não duplica.
    return erroNoFormulario("Sem conexão. Verifique a internet e toque em Enviar pedido de novo (não será duplicado).");
  }

  let dados = {};
  try { dados = await resposta.json(); } catch (erro) { /* resposta sem JSON */ }

  if (!resposta.ok) {
    if (resposta.status >= 500) return erroNoFormulario(dados.erro || "O servidor não conseguiu registrar o pedido. Tente de novo em instantes.");
    pedidoIdPendente = null; // o servidor recusou: nada foi criado
    if (dados.codigo === "produto_indisponivel" && Array.isArray(dados.produtoIds)) {
      substituirItens(lerCarrinho().itens.filter((i) => !dados.produtoIds.includes(i.produtoId)));
      await atualizarDoServidor();
      return mostrarAviso(dados.erro || "Alguns itens não estão mais disponíveis e saíram do carrinho.", "erro");
    }
    if (dados.codigo === "cupom_invalido") {
      cupom = null;
      versaoCupom++;
      desenhar();
      mensagemCupom("");
      return mostrarAviso(`${dados.erro || "O cupom não vale mais."} O cupom foi removido: confira o novo total.`, "erro");
    }
    if (dados.codigo === "preco_mudou" || dados.codigo === "fechado") {
      await atualizarDoServidor();
      return mostrarAviso(dados.erro, "erro");
    }
    return erroNoFormulario(dados.erro || "Não foi possível enviar o pedido.");
  }

  if (!dados.pedidoId) return erroNoFormulario("Resposta inesperada do servidor. Tente de novo.");
  salvarCliente({ nome, telefone, endereco, referencia });
  limparCarrinho();
  location.assign(`/pedido?r=${encodeURIComponent(carrinho.restauranteId)}&p=${encodeURIComponent(dados.pedidoId)}`);
}

$("#pedidoForm").addEventListener("submit", (evento) => {
  evento.preventDefault();
  executar(botaoDe(evento), enviar);
});

atualizarDoServidor().finally(() => $("#carregando").classList.add("oculto"));
