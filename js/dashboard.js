// Deu Fome — dashboard do restaurante. Lê só os resumos diários (restaurantes/{id}/resumos), nunca todos os pedidos.
import { auth, db } from "./firebase-config.js";
import { $, criar, formatarMoeda, mensagemErroFirebase } from "./utils.js";
import { totalizar, intervalo } from "./dashboard-calculo.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, documentId, getDocs, orderBy, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ROTULO_PAGAMENTO = { pix: "Pix", dinheiro: "Dinheiro", cartao: "Cartão", outro: "Outro" };
let carga = 0;
let restauranteId = "";

const kpi = (rotulo, valor, dica) => criar("div", { class: "kpi" }, criar("small", { texto: rotulo }), criar("strong", { texto: valor }), dica ? criar("small", { texto: dica }) : "");

function barras(alvo, itens, rotulo) {
  const maior = Math.max(1, ...itens.map((i) => i.valor));
  alvo.replaceChildren(...itens.map((i) => {
    const b = criar("i", {});
    b.style.height = `${Math.round((i.valor / maior) * 100)}%`;
    return criar("div", { class: "barra", title: i.titulo }, b, criar("span", { texto: rotulo(i) }));
  }));
}

function lista(alvo, titulo, linhas) {
  if (!linhas.length) { alvo.replaceChildren(); return; }
  alvo.replaceChildren(criar("h3", { texto: titulo }), ...linhas.map(([a, b]) => criar("div", { class: "linha-rank" }, criar("span", { texto: a }), criar("span", { texto: b }))));
}

function desenhar(t) {
  $("#vazio").classList.toggle("oculto", t.pedidos > 0);
  const margem = t.margemPercentual === null ? "—" : `${String(t.margemPercentual).replace(".", ",")}%`;
  const dicaMargem = t.coberturaCusto === null ? "" : `${t.coberturaCusto}% das entregas com custo cadastrado`;
  $("#kpis").replaceChildren(
    kpi("Faturamento", formatarMoeda(t.faturamentoCentavos), `${t.entregues} entregues`),
    kpi("Ticket médio", formatarMoeda(t.ticketMedioCentavos)),
    kpi("Lucro estimado", t.margemPercentual === null ? "—" : formatarMoeda(t.lucroCentavos), dicaMargem),
    kpi("Margem", margem),
    kpi("Pedidos feitos", String(t.pedidos), `${t.cancelados} cancelados`),
    kpi("Descontos dados", formatarMoeda(t.descontoCentavos + t.descontoEntregaCentavos), "cupons (produtos + frete)")
  );
  barras($("#graficoDias"), t.porDia.map((d) => ({ valor: d.faturamentoCentavos, dia: d.dia, titulo: `${d.dia}: ${formatarMoeda(d.faturamentoCentavos)}` })), (i) => i.dia.slice(8) + "/" + i.dia.slice(5, 7));
  lista($("#listaVendidos"), "", t.maisVendidos.map((p) => [`${p.quantidade}× ${p.nome}`, formatarMoeda(p.receitaCentavos)]));
  if (!t.maisVendidos.length) $("#listaVendidos").replaceChildren(criar("p", { class: "texto-suave", texto: "Sem vendas no período." }));
  barras($("#graficoHoras"), t.horarios.map((h) => ({ valor: h.qtd, hora: h.hora, titulo: `${h.hora}h: ${h.qtd} pedidos` })), (i) => i.hora);
  lista($("#listaPagamentos"), "Formas de pagamento", Object.entries(t.pagamentos).sort((a, b) => b[1] - a[1]).map(([f, q]) => [ROTULO_PAGAMENTO[f] || f, `${q} entregas`]));
  lista($("#listaCupons"), "Cupons usados", Object.entries(t.cupons).sort((a, b) => b[1] - a[1]).map(([c, q]) => [c, `${q} entregas`]));
}

async function carregar() {
  const minha = ++carga;
  const { inicio, fim } = intervalo(Number($("#periodo").value));
  $("#erroCarga").classList.add("oculto");
  try {
    const q = query(collection(db, "restaurantes", restauranteId, "resumos"), where(documentId(), ">=", inicio), where(documentId(), "<=", fim), orderBy(documentId()));
    const snap = await getDocs(q);
    if (minha !== carga) return;
    desenhar(totalizar(snap.docs.map((d) => ({ ...d.data(), id: d.id }))));
  } catch (erro) {
    if (minha !== carga) return;
    $("#erroCarga").textContent = mensagemErroFirebase(erro);
    $("#erroCarga").classList.remove("oculto");
  }
}

function escolher(id) { restauranteId = id; $("#conteudo").classList.remove("oculto"); carregar(); }
$("#periodo").addEventListener("change", carregar);
$("#seletorRestaurante").addEventListener("change", (e) => escolher(e.target.value));

onAuthStateChanged(auth, async (user) => {
  const minha = ++carga;
  $("#semLogin").classList.toggle("oculto", !!user);
  $("#app").classList.toggle("oculto", !user);
  for (const s of ["#semVinculo", "#seletorArea", "#conteudo"]) $(s).classList.add("oculto");
  if (!user) return;
  try {
    const snapshot = await getDocs(collection(db, "usuarios", user.uid, "restaurantes"));
    if (minha !== carga) return;
    const vinculos = snapshot.docs.map((d) => ({ ...d.data(), id: d.id })).filter((v) => v.ativo !== false);
    if (!vinculos.length) { $("#semVinculo").classList.remove("oculto"); return; }
    $("#seletorRestaurante").replaceChildren(...vinculos.map((v) => criar("option", { value: v.id, texto: v.nome || v.id })));
    $("#seletorArea").classList.toggle("oculto", vinculos.length < 2);
    escolher(vinculos[0].id);
  } catch (erro) {
    if (minha !== carga) return;
    $("#erroCarga").textContent = mensagemErroFirebase(erro);
    $("#erroCarga").classList.remove("oculto");
  }
});
