// Deu Fome — carrinho e dados do cliente, guardados só neste aparelho (localStorage).
// Os preços aqui servem apenas para mostrar na tela: o servidor recalcula tudo ao receber o pedido.

const CHAVE_CARRINHO = "deufome-carrinho";
const CHAVE_CLIENTE = "deufome-cliente";
export const MAX_POR_ITEM = 20;

function carrinhoVazio() {
  return { restauranteId: "", restauranteNome: "", itens: [] };
}

export function lerCarrinho() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_CARRINHO) || "null");
    if (bruto && typeof bruto.restauranteId === "string" && Array.isArray(bruto.itens)) {
      const itens = bruto.itens.filter((i) => i && typeof i.produtoId === "string"
        && Number.isInteger(i.quantidade) && i.quantidade > 0
        && Number.isInteger(i.precoCentavos) && i.precoCentavos > 0);
      if (itens.length) {
        return { restauranteId: bruto.restauranteId, restauranteNome: String(bruto.restauranteNome || ""), itens };
      }
    }
  } catch (erro) { /* sem armazenamento ou dado corrompido: começa vazio */ }
  return carrinhoVazio();
}

function salvar(carrinho) {
  try { localStorage.setItem(CHAVE_CARRINHO, JSON.stringify(carrinho)); } catch (erro) { /* ignora */ }
  return carrinho;
}

export function limparCarrinho() {
  try { localStorage.removeItem(CHAVE_CARRINHO); } catch (erro) { /* ignora */ }
}

// Há itens de OUTRO restaurante no carrinho? (só um restaurante por pedido)
export function carrinhoDeOutroRestaurante(restauranteId) {
  const carrinho = lerCarrinho();
  return carrinho.itens.length > 0 && carrinho.restauranteId !== restauranteId;
}

// Adiciona 1 unidade. Se o carrinho era de outro restaurante, começa um novo (quem chama pergunta antes).
export function adicionar(restaurante, produto) {
  let carrinho = lerCarrinho();
  if (carrinho.restauranteId !== restaurante.id) {
    carrinho = { restauranteId: restaurante.id, restauranteNome: restaurante.nome, itens: [] };
  }
  const existente = carrinho.itens.find((i) => i.produtoId === produto.id);
  if (existente) {
    existente.quantidade = Math.min(existente.quantidade + 1, MAX_POR_ITEM);
    existente.nome = produto.nome;
    existente.precoCentavos = produto.precoCentavos;
  } else {
    carrinho.itens.push({ produtoId: produto.id, nome: produto.nome, precoCentavos: produto.precoCentavos, quantidade: 1 });
  }
  return salvar(carrinho);
}

export function alterarQuantidade(produtoId, delta) {
  const carrinho = lerCarrinho();
  const item = carrinho.itens.find((i) => i.produtoId === produtoId);
  if (!item) return carrinho;
  item.quantidade = Math.min(item.quantidade + delta, MAX_POR_ITEM);
  carrinho.itens = carrinho.itens.filter((i) => i.quantidade > 0);
  if (!carrinho.itens.length) {
    limparCarrinho();
    return carrinhoVazio();
  }
  return salvar(carrinho);
}

export function removerItem(produtoId) {
  const carrinho = lerCarrinho();
  carrinho.itens = carrinho.itens.filter((i) => i.produtoId !== produtoId);
  if (!carrinho.itens.length) {
    limparCarrinho();
    return carrinhoVazio();
  }
  return salvar(carrinho);
}

// Troca a lista de itens (usado quando preços/disponibilidade mudaram)
export function substituirItens(itens) {
  const carrinho = lerCarrinho();
  if (!itens.length) {
    limparCarrinho();
    return carrinhoVazio();
  }
  carrinho.itens = itens;
  return salvar(carrinho);
}

export function totalDeItens(carrinho) {
  return carrinho.itens.reduce((soma, i) => soma + i.quantidade, 0);
}

export function subtotalCentavos(carrinho) {
  return carrinho.itens.reduce((soma, i) => soma + i.precoCentavos * i.quantidade, 0);
}

// Dados do cliente lembrados para o próximo pedido (só neste aparelho)
export function lerCliente() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE_CLIENTE) || "null");
    if (bruto && typeof bruto === "object") {
      return {
        nome: String(bruto.nome || ""), telefone: String(bruto.telefone || ""),
        endereco: String(bruto.endereco || ""), referencia: String(bruto.referencia || ""),
        // Campos opcionais de análise (só mudam se o cliente marcar o consentimento no carrinho)
        bairro: String(bruto.bairro || ""), faixaEtaria: String(bruto.faixaEtaria || ""),
        comoConheceu: String(bruto.comoConheceu || ""), consentimentoAnalise: bruto.consentimentoAnalise === true
      };
    }
  } catch (erro) { /* ignora */ }
  return { nome: "", telefone: "", endereco: "", referencia: "", bairro: "", faixaEtaria: "", comoConheceu: "", consentimentoAnalise: false };
}

export function salvarCliente(dados) {
  try { localStorage.setItem(CHAVE_CLIENTE, JSON.stringify(dados)); } catch (erro) { /* ignora */ }
}

// Chave de reenvio do pedido (24 caracteres aleatórios): evita pedido duplicado se a rede falhar.
// NÃO é o endereço do pedido: o código secreto de acompanhamento é gerado pelo servidor (api/_id-pedido.js).
export function novoPedidoId() {
  const bytes = new Uint8Array(12);
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
