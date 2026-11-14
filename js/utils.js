// Deu Fome — utilitários compartilhados (sem dependências)

export const STATUS_PEDIDO = {
  NOVO: "novo",
  PREPARANDO: "preparando",
  SAIU: "saiu_para_entrega",
  ENTREGUE: "entregue",
  CANCELADO: "cancelado"
};

export const ROTULO_STATUS = {
  novo: "Novo",
  preparando: "Preparando",
  saiu_para_entrega: "Saiu para entrega",
  entregue: "Entregue",
  cancelado: "Cancelado"
};

// Atalhos de DOM
export const $ = (seletor, raiz = document) => raiz.querySelector(seletor);
export const $$ = (seletor, raiz = document) => Array.from(raiz.querySelectorAll(seletor));

// Escapa texto antes de colocar em innerHTML (evita XSS)
export function escapeHtml(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Dinheiro: guardamos SEMPRE em centavos (inteiro) para evitar erro de ponto flutuante
export function formatarMoeda(centavos) {
  const valor = Number(centavos || 0) / 100;
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// "12,50" ou "R$ 12,50" -> 1250
export function paraCentavos(texto) {
  const limpo = String(texto ?? "")
    .replace(/[^\d,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const numero = parseFloat(limpo);
  return Number.isFinite(numero) ? Math.round(numero * 100) : 0;
}

// Aceita Date, Timestamp do Firestore (toDate) ou número
export function formatarDataHora(valor) {
  if (!valor) return "—";
  const data = typeof valor.toDate === "function" ? valor.toDate() : new Date(valor);
  if (Number.isNaN(data.getTime())) return "—";
  return data.toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

// Telefone: mantém só dígitos (DDD + número)
export function soDigitos(texto) {
  return String(texto ?? "").replace(/\D/g, "");
}

export function formatarTelefone(texto) {
  const d = soDigitos(texto).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

export function telefoneValido(texto) {
  const d = soDigitos(texto);
  return d.length === 10 || d.length === 11;
}

export function emailValido(texto) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(texto ?? "").trim());
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Aviso rápido na tela (precisa de <div id="toasts"></div> ou cria sozinho)
export function toast(mensagem, tipo = "info", duracao = 3500) {
  let area = document.getElementById("toasts");
  if (!area) {
    area = document.createElement("div");
    area.id = "toasts";
    area.setAttribute("aria-live", "polite");
    document.body.appendChild(area);
  }
  const el = document.createElement("div");
  el.className = `toast toast-${tipo}`;
  el.textContent = mensagem;
  area.appendChild(el);
  setTimeout(() => {
    el.classList.add("saindo");
    setTimeout(() => el.remove(), 300);
  }, duracao);
}

// Traduz erros comuns do Firebase para português
export function mensagemErroFirebase(erro) {
  const codigo = (erro && erro.code) || "";
  const mapa = {
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/wrong-password": "E-mail ou senha incorretos.",
    "auth/user-not-found": "Usuário não encontrado.",
    "auth/invalid-email": "E-mail inválido.",
    "auth/too-many-requests": "Muitas tentativas. Aguarde um pouco e tente de novo.",
    "auth/network-request-failed": "Sem conexão com a internet.",
    "auth/invalid-api-key": "apiKey inválida em js/firebase-config.js.",
    "permission-denied": "Sem permissão (verifique as regras do Firestore).",
    "unavailable": "Serviço indisponível ou sem internet.",
    "not-found": "Registro não encontrado."
  };
  return mapa[codigo] || (erro && erro.message) || "Erro desconhecido.";
}
