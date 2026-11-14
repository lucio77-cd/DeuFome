// Deu Fome — funções das telas do cliente (Etapa 2): horário de funcionamento e textos
import { formatarMoeda } from "./utils.js";

const FUSO = "America/Sao_Paulo"; // Treze Tílias usa o horário de Brasília

function paraMinutos(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
}

// Minutos desde 00:00 no horário de Brasília (independe do fuso do celular)
function minutosAgora(data) {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(data);
  const h = Number(partes.find((p) => p.type === "hour").value);
  const m = Number(partes.find((p) => p.type === "minute").value);
  return h * 60 + m;
}

// Aceita virada da meia-noite: abre 18:00 e fecha 02:00. Abertura igual ao fechamento = 24 horas.
export function dentroDoHorario(abertura, fechamento, agora = new Date()) {
  const a = paraMinutos(abertura);
  const f = paraMinutos(fechamento);
  if (a === null || f === null) return false;
  if (a === f) return true;
  const n = minutosAgora(agora);
  return a < f ? n >= a && n < f : n >= a || n < f;
}

// Situação do restaurante para o cliente: precisa estar com "aberto" ligado E dentro do horário
export function statusRestaurante(r, agora = new Date()) {
  if (r.aberto !== true) {
    return { aberto: false, texto: "Fechado", classe: "selo-erro", detalhe: "Não está aceitando pedidos agora." };
  }
  if (!dentroDoHorario(r.horarioAbertura, r.horarioFechamento, agora)) {
    return { aberto: false, texto: "Fechado", classe: "selo-erro", detalhe: `Abre às ${r.horarioAbertura}.` };
  }
  return { aberto: true, texto: "Aberto agora", classe: "selo-ok", detalhe: `Fecha às ${r.horarioFechamento}.` };
}

export function textoTaxa(r) {
  const taxa = Number(r.taxaEntregaCentavos || 0);
  return taxa > 0 ? `Entrega ${formatarMoeda(taxa)}` : "Entrega grátis";
}

export function textoHorario(r) {
  return `Das ${r.horarioAbertura} às ${r.horarioFechamento}`;
}
