// Deu Fome — cardápio público de um restaurante (Etapa 2). Endereço: /restaurante?r=ID
import { db } from "./firebase-config.js";
import { $, criar, formatarMoeda, mensagemErroFirebase } from "./utils.js";
import { statusRestaurante, textoTaxa, textoHorario } from "./cliente.js";
import { collection, doc, getDoc, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const conteudo = $("#conteudo");

function aviso(texto) {
  conteudo.replaceChildren(
    criar("p", { class: "mensagem erro card", texto }),
    criar("a", { class: "btn btn-secundario btn-bloco", href: "/", texto: "Ver todos os restaurantes" })
  );
}

function desenhar(restaurante, categorias, produtos) {
  const status = statusRestaurante(restaurante);
  document.title = `${restaurante.nome} — Deu Fome`;

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
  if (!status.aberto) {
    cabecalho.append(criar("p", { class: "mensagem aviso", texto: `Fechado agora. ${status.detalhe} Você pode ver o cardápio.` }));
  }
  cabecalho.append(criar("p", { class: "texto-suave", texto: "Os pedidos online chegam na próxima etapa." }));

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
          return criar("div", { class: "produto" + (pausado ? " indisponivel" : "") },
            criar("div", { class: "produto-info" },
              criar("strong", { texto: p.nome }),
              p.descricao ? criar("p", { class: "texto-suave", texto: p.descricao }) : ""),
            criar("div", { class: "produto-preco" },
              criar("span", { texto: formatarMoeda(p.precoCentavos) }),
              pausado ? criar("span", { class: "selo selo-aviso", texto: "Indisponível" }) : ""));
        })));
    }
  }
  conteudo.replaceChildren(...blocos);
}

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
      snapshot.data(),
      cats.docs.map((d) => ({ ...d.data(), id: d.id })),
      prods.docs.map((d) => ({ ...d.data(), id: d.id }))
    );
  } catch (erro) {
    aviso(mensagemErroFirebase(erro));
  }
}

carregar();
