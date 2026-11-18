// Deu Fome — "Meus pedidos": histórico do cliente logado com o Google.
// Lê o índice privado clientes/{uid}/pedidos (gravado só pelo servidor, ao criar o pedido) e, para cada
// pedido, o status atual no documento público de acompanhamento. Sem telefone nem endereço.
import { $, criar, formatarMoeda, formatarDataHora, ROTULO_STATUS, mensagemErroFirebase, executar } from "./utils.js";
import { dbCliente, aoMudarLogin, entrarComGoogle, sairDaConta } from "./cliente-auth.js";
import { collection, doc, getDoc, getDocs, limit, orderBy, query } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const lista = $("#lista");
let carga = 0; // descarta respostas antigas se a conta mudar durante o carregamento

async function carregar(user) {
  const minha = ++carga;
  lista.replaceChildren(criar("p", { class: "texto-suave centro", texto: "Carregando seus pedidos..." }));
  try {
    const indice = await getDocs(query(collection(dbCliente, "clientes", user.uid, "pedidos"), orderBy("criadoEm", "desc"), limit(20)));
    if (minha !== carga) return;
    if (indice.empty) {
      lista.replaceChildren(criar("p", { class: "card centro texto-suave", texto: "Você ainda não fez nenhum pedido por aqui." }));
      return;
    }
    // O status vem do acompanhamento público (quem tem o código do pedido lê só aquele documento)
    const acompanhamentos = await Promise.all(indice.docs.map((d) =>
      getDoc(doc(dbCliente, "restaurantes", d.data().restauranteId, "acompanhamento", d.id)).catch(() => null)));
    if (minha !== carga) return;
    lista.replaceChildren(...indice.docs.map((d, i) => {
      const p = d.data();
      const acomp = acompanhamentos[i] && acompanhamentos[i].exists() ? acompanhamentos[i].data() : null;
      const status = acomp ? (ROTULO_STATUS[acomp.status] || acomp.status) : "—";
      return criar("a", {
        class: "card card-link", href: `/pedido?r=${encodeURIComponent(p.restauranteId)}&p=${encodeURIComponent(d.id)}`
      },
        criar("strong", { texto: `${p.restauranteNome || "Restaurante"} · Pedido #${p.numero}` }),
        criar("p", { class: "texto-suave texto-pequeno", texto: formatarDataHora(p.criadoEm) }),
        criar("p", { texto: `${formatarMoeda(p.totalCentavos)} · ${status}` }));
    }));
  } catch (erro) {
    if (minha !== carga) return;
    lista.replaceChildren(criar("p", { class: "mensagem erro", texto: mensagemErroFirebase(erro) }));
  }
}

function aoMudar(user) {
  $("#carregando").classList.add("oculto");
  $("#login").classList.toggle("oculto", !!user);
  $("#conta").classList.toggle("oculto", !user);
  if (!user) {
    carga++;
    lista.replaceChildren();
    return;
  }
  $("#loginMsg").textContent = "";
  $("#nomeGoogle").textContent = user.displayName || "sua conta Google";
  carregar(user);
}

$("#entrarGoogle").addEventListener("click", (evento) => {
  executar(evento.currentTarget, async () => {
    $("#loginMsg").textContent = "";
    try {
      await entrarComGoogle();
    } catch (erro) {
      $("#loginMsg").textContent = mensagemErroFirebase(erro);
    }
  });
});
$("#sairConta").addEventListener("click", () => { sairDaConta().catch(() => {}); });

aoMudarLogin(aoMudar);
