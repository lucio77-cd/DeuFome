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

// Texto digitado -> centavos (inteiro), ou null se o texto não for um valor válido.
// "12,50" | "R$ 12,50" | "12.50" -> 1250    "1.250,50" | "1,250.50" -> 125050
// "1.250" -> 125000 (ponto seguido de 3 dígitos é milhar)   "" | "abc" | "-5" | "12,505" -> null
// Trabalha com texto (sem float), então não existe erro de arredondamento.
export function paraCentavos(texto) {
  const s = String(texto ?? "").replace(/R\$/gi, "").replace(/\s/g, "");
  if (!s || !/^[\d.,]+$/.test(s)) return null;

  const ultimoPonto = s.lastIndexOf(".");
  const ultimaVirgula = s.lastIndexOf(",");
  const qtdPontos = s.split(".").length - 1;
  const qtdVirgulas = s.split(",").length - 1;

  // Descobre qual caractere é o separador decimal (o outro, se existir, é milhar)
  let posDecimal = -1;
  if (qtdPontos && qtdVirgulas) {
    posDecimal = Math.max(ultimoPonto, ultimaVirgula);
  } else if (qtdVirgulas === 1) {
    posDecimal = ultimaVirgula;
  } else if (qtdPontos === 1 && s.length - ultimoPonto - 1 <= 2) {
    posDecimal = ultimoPonto; // "12.5" ou "12.50" (teclado com ponto decimal)
  }

  const inteiraBruta = posDecimal >= 0 ? s.slice(0, posDecimal) : s;
  const parteDecimal = posDecimal >= 0 ? s.slice(posDecimal + 1) : "";
  if (/[.,]/.test(parteDecimal) || parteDecimal.length > 2) return null;
  // Separadores na parte inteira só valem como milhar: "1.250" ou "1.250.000" (sempre o mesmo, grupos de 3)
  if (/[.,]/.test(inteiraBruta) && !/^\d{1,3}([.,])\d{3}(\1\d{3})*$/.test(inteiraBruta)) return null;
  const parteInteira = inteiraBruta.replace(/[.,]/g, "");

  const centavos = Number(parteInteira || "0") * 100 + Number((parteDecimal + "00").slice(0, 2));
  return Number.isSafeInteger(centavos) ? centavos : null;
}

// Centavos -> texto para campos de formulário ("12,50")
export function centavosParaTexto(centavos) {
  return (Number(centavos || 0) / 100).toFixed(2).replace(".", ",");
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

// Chama uma função do servidor (/api/...). Com "token" (usuario.getIdToken()) manda o login do painel.
// Erros do servidor viram Error com a mensagem em português que a própria API devolveu.
export async function chamarApi(caminho, corpo, token) {
  const cabecalhos = { "Content-Type": "application/json" };
  if (token) cabecalhos.Authorization = `Bearer ${token}`;
  let resposta;
  try {
    resposta = await fetch(caminho, { method: "POST", headers: cabecalhos, body: JSON.stringify(corpo || {}) });
  } catch (erro) {
    throw new Error("Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) {
    const falha = new Error(dados.erro || "Não foi possível concluir. Tente de novo.");
    falha.dados = dados;
    throw falha;
  }
  return dados;
}

// Cria um elemento sem usar innerHTML: criar("div", { class: "x", texto: "oi" }, filho1, filho2)
// Atributos especiais: class, texto (textContent) e data-*; o resto vira propriedade (type, value...)
export function criar(tag, atributos = {}, ...filhos) {
  const no = document.createElement(tag);
  for (const [chave, valor] of Object.entries(atributos)) {
    if (chave === "class") no.className = valor;
    else if (chave === "texto") no.textContent = valor;
    else if (chave.startsWith("data-")) no.setAttribute(chave, valor);
    else no[chave] = valor;
  }
  no.append(...filhos);
  return no;
}

// Botão que enviou o formulário (com alternativa para navegadores antigos)
export function botaoDe(evento) {
  return evento.submitter || evento.target.querySelector("[type=submit]");
}

// Desabilita o botão enquanto a tarefa roda (evita clique duplo gravando duas vezes)
// e mostra qualquer erro como aviso na tela.
export async function executar(botao, tarefa) {
  if (botao.disabled) return;
  botao.disabled = true;
  try {
    await tarefa();
  } catch (erro) {
    toast(mensagemErroFirebase(erro), "erro");
  } finally {
    botao.disabled = false;
  }
}
