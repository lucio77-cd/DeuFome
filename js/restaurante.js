// Deu Fome — cardápio público de um restaurante, com botão Adicionar e barra do carrinho (Etapa 3)
// Endereço: /restaurante?r=ID
import { db } from "./firebase-config.js";
import { $, criar, formatarMoeda, mensagemErroFirebase, toast } from "./utils.js";
import { statusRestaurante, textoTaxa, textoHorario } from "./cliente.js";
import { lerCarrinho, adicionar, carrinhoDeOutroRestaurante, totalDeItens, subtotalCentavos } from "./carrinho.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const conteudo = $("#conteudo");
let contexto = null; // cardápio na tela: { id, nome, produtos: Map(id -> produto) }

function aviso(texto) {
  conteudo.replaceChildren(
    criar("p", { class: "mensagem erro card", texto }),
    criar("a", { class: "btn btn-secundario btn-bloco", href: "/", texto: "Ver todos os restaurantes" })
  );
}

// Barra fixa no rodapé com o resumo do carrinho (some quando o carrinho está vazio)
function atualizarBarra() {
  let barra = document.getElementById("barraCarrinho");
  const carrinho = lerCarrinho();
  const quantidade = totalDeItens(carrinho);
  if (!quantidade) {
    if (barra) barra.remove();
    document.body.classList.remove("body-com-barra");
    return;
  }
  if (!barra) {
    barra = criar("a", { id: "barraCarrinho", class: "barra-carrinho", href: "/carrinho" });
    document.body.append(barra);
  }
  barra.replaceChildren(
    criar("span", { texto: `🛒 Ver carrinho (${quantidade} ${quantidade === 1 ? "item" : "itens"})` }),
    criar("strong", { texto: formatarMoeda(subtotalCentavos(carrinho)) })
  );
  document.body.classList.add("body-com-barra");
}

function desenhar(id, restaurante, categorias, produtos) {
  const status = statusRestaurante(restaurante);
  document.title = `${restaurante.nome} — Deu Fome`;
  contexto = { id, nome: restaurante.nome, produtos: new Map(produtos.map((p) => [p.id, p])) };

  categorias.sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0)
    || String(a.nome).localeCompare(String(b.nome), "pt-BR"));

  // Produto de categoria inativa (ou inexistente) não aparece; disponíveis vêm antes dos pausados
  const porCategoria = new Map(categorias.map((c) => [c.id, []]));
  for (const p of produtos) {
    const grupo = porCategoria.get(p.categoriaId);
    if (grupo) grupo.push(p);
  }
  for (const grupo of porCategoria.values()) {
    grupo.sort((a, b) => Number(b.disponivel !== false) - Number(a.disponivel !== false)
      || String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  }
  const secoes = categorias.filter((c) => porCategoria.get(c.id).length > 0);

  const cabecalho = criar("section", { class: "card cardapio-cabecalho" },
    criar("h1", { texto: restaurante.nome }),
    criar("span", { class: `selo ${status.classe}`, texto: status.texto }),
    criar("p", { class: "texto-suave", style: "margin-top:10px", texto: `${textoTaxa(restaurante)} · ${textoHorario(restaurante)}` })
  );
  if (status.aberto) {
    cabecalho.append(criar("p", { class: "texto-suave", texto: "Toque em Adicionar para montar seu pedido." }));
  } else {
    cabecalho.append(criar("p", { class: "mensagem aviso", texto: `Fechado agora. ${status.detalhe} Você pode ver o cardápio, mas só dá para pedir com o restaurante aberto.` }));
  }

  const blocos = [cabecalho];

  if (!secoes.length) {
    blocos.push(criar("p", { class: "texto-suave centro", texto: "O cardápio deste restaurante está sendo preparado." }));
  } else {
    if (secoes.length > 1) {
      blocos.push(criar("nav", { class: "chips" },
        ...secoes.map((c) => criar("a", { class: "chip", href: `#cat-${c.id}`, texto: c.nome }))));
    }
    for (const c of secoes) {
      blocos.push(criar("section", { class: "card categoria", id: `cat-${c.id}` },
        criar("h2", { texto: c.nome }),
        ...porCategoria.get(c.id).map((p) => {
          const pausado = p.disponivel === false;
          let acao = "";
          if (pausado) acao = criar("span", { class: "selo selo-aviso", texto: "Indisponível" });
          else if (status.aberto) acao = criar("button", { class: "btn btn-pequeno", type: "button", texto: "Adicionar", "data-produto": p.id });
          return criar("div", { class: "produto" + (pausado ? " indisponivel" : "") },
            criar("div", { class: "produto-info" },
              criar("strong", { texto: p.nome }),
              p.descricao ? criar("p", { class: "texto-suave", texto: p.descricao }) : ""),
            criar("div", { class: "produto-preco" },
              criar("span", { texto: formatarMoeda(p.precoCentavos) }),
              acao));
        })));
    }
  }
  conteudo.replaceChildren(...blocos);
  atualizarBarra();
}

// Clique em "Adicionar"
conteudo.addEventListener("click", (evento) => {
  const botao = evento.target.closest("button[data-produto]");
  if (!botao || !contexto) return;
  const produto = contexto.produtos.get(botao.dataset.produto);
  if (!produto) return;
  if (carrinhoDeOutroRestaurante(contexto.id)) {
    const outro = lerCarrinho().restauranteNome || "outro restaurante";
    if (!confirm(`Seu carrinho tem itens de "${outro}". Esvaziar e começar um carrinho em "${contexto.nome}"?`)) return;
  }
  adicionar({ id: contexto.id, nome: contexto.nome }, produto);
  toast(`${produto.nome} adicionado.`, "sucesso", 1500);
  atualizarBarra();
});

async function carregar() {
  const id = new URLSearchParams(location.search).get("r") || "";
  if (!/^[A-Za-z0-9]{1,64}$/.test(id)) return aviso("Restaurante não encontrado.");

  try {
    const ref = doc(db, "restaurantes", id);
    let snapshot;
    try {
      snapshot = await getDoc(ref);
    } catch (erro) {
      // Restaurante inexistente ou desativado: as regras negam a leitura
      if (erro && erro.code === "permission-denied") return aviso("Restaurante não encontrado ou indisponível.");
      throw erro;
    }
    if (!snapshot.exists() || snapshot.data().ativo !== true) return aviso("Restaurante não encontrado ou indisponível.");

    // where ativo == true é exigido pelas regras (público não lê categoria inativa nem produto arquivado)
    const [cats, prods] = await Promise.all([
      getDocs(query(collection(ref, "categorias"), where("ativo", "==", true))),
      getDocs(query(collection(ref, "produtos"), where("ativo", "==", true)))
    ]);
    desenhar(
      id,
      snapshot.data(),
      cats.docs.map((d) => ({ ...d.data(), id: d.id })),
      prods.docs.map((d) => ({ ...d.data(), id: d.id }))
    );
  } catch (erro) {
    aviso(mensagemErroFirebase(erro));
  }
}

// Voltando pelo botão "voltar" do navegador, o carrinho pode ter mudado
window.addEventListener("pageshow", atualizarBarra);
carregar();
