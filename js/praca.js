// Deu Fome — praça de alimentação (Etapa 2): lista os restaurantes ativos, sem login
import { db } from "./firebase-config.js";
import { $, criar, mensagemErroFirebase } from "./utils.js";
import { statusRestaurante, textoTaxa } from "./cliente.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const lista = $("#lista");
const botaoAtualizar = $("#atualizar");
let restaurantes = [];

// Desenha a lista com o status calculado agora (abertos primeiro, depois ordem alfabética)
function desenhar() {
  lista.replaceChildren();
  if (!restaurantes.length) {
    lista.append(criar("p", { class: "texto-suave centro", texto: "Nenhum restaurante disponível por enquanto. Volte em breve!" }));
    return;
  }
  const agora = new Date();
  const itens = restaurantes
    .map((r) => ({ r, status: statusRestaurante(r, agora) }))
    .sort((a, b) => Number(b.status.aberto) - Number(a.status.aberto)
      || String(a.r.nome).localeCompare(String(b.r.nome), "pt-BR"));

  for (const { r, status } of itens) {
    lista.append(criar("a", {
      class: "card restaurante-card" + (status.aberto ? "" : " fechado"),
      href: `/restaurante?r=${encodeURIComponent(r.id)}`
    },
      criar("div", { class: "restaurante-topo" },
        criar("strong", { class: "restaurante-nome", texto: r.nome || "Restaurante" }),
        criar("span", { class: `selo ${status.classe}`, texto: status.texto })),
      criar("p", { class: "texto-suave restaurante-info", texto: `${textoTaxa(r)} · ${status.detalhe}` })
    ));
  }
}

async function carregar() {
  botaoAtualizar.disabled = true;
  lista.replaceChildren(criar("p", { class: "texto-suave centro", texto: "Carregando restaurantes..." }));
  try {
    // where ativo == true é exigido pelas regras: o público só lista restaurantes ativos
    const snapshot = await getDocs(query(collection(db, "restaurantes"), where("ativo", "==", true)));
    restaurantes = snapshot.docs.map((d) => ({ ...d.data(), id: d.id }));
    desenhar();
  } catch (erro) {
    lista.replaceChildren(criar("p", { class: "mensagem erro", texto: mensagemErroFirebase(erro) }));
  } finally {
    botaoAtualizar.disabled = false;
  }
}

botaoAtualizar.addEventListener("click", carregar);
// "Aberto agora" muda com o relógio: redesenha a cada minuto sem buscar de novo
setInterval(() => { if (restaurantes.length) desenhar(); }, 60000);
carregar();
