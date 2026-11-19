// Deu Fome — barra de navegação do cliente (fixa embaixo, como nos apps de delivery): Início, Carrinho, Pedidos.
// Restaurante e administração não aparecem aqui: entram pelo endereço direto (/painel e /admin).
import { lerCarrinho, totalDeItens } from "./carrinho.js";

const ICONES = {
  inicio: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  carrinho: '<path d="M3 4h2.2l2.1 10.2a1 1 0 0 0 1 .8h8.4a1 1 0 0 0 1-.8L19.5 8H6.2"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
  pedidos: '<path d="M7 3h10a1 1 0 0 1 1 1v17l-3-2-3 2-3-2-3 2V4a1 1 0 0 1 1-1z"/><path d="M9 8h6M9 12h6"/>'
};
const ABAS = [
  { id: "inicio", texto: "Início", href: "/", rotas: ["/", "/index", "/restaurante"] },
  { id: "carrinho", texto: "Carrinho", href: "/carrinho", rotas: ["/carrinho"] },
  { id: "pedidos", texto: "Pedidos", href: "/meus-pedidos", rotas: ["/meus-pedidos", "/pedido"] }
];

function quantidade() {
  try { return totalDeItens(lerCarrinho()); } catch (erro) { return 0; }
}

const caminho = location.pathname.replace(/\.html$/, "").replace(/(.)\/$/, "$1");
const nav = document.createElement("nav");
nav.className = "menu-cliente";
nav.setAttribute("aria-label", "Navegação principal");
for (const aba of ABAS) {
  const a = document.createElement("a");
  a.href = aba.href;
  if (aba.rotas.includes(caminho)) { a.className = "ativa"; a.setAttribute("aria-current", "page"); }
  a.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES[aba.id]}</svg><span>${aba.texto}</span>`;
  if (aba.id === "carrinho" && quantidade() > 0) {
    const sel = document.createElement("b");
    sel.className = "menu-selo";
    sel.textContent = String(quantidade());
    a.append(sel);
  }
  nav.append(a);
}
document.body.append(nav);
document.body.classList.add("com-menu");
