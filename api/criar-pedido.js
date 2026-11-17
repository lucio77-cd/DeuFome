// Deu Fome — POST /api/criar-pedido (função serverless da Vercel)
// O cliente manda só IDs e quantidades. Preço, taxa e total são calculados AQUI, lendo o Firestore
// com a conta de serviço (variável de ambiente FIREBASE_SERVICE_ACCOUNT). As regras do Firestore
// negam a criação de pedido pelo navegador: só esta função grava pedidos.
//
// Grava DOIS documentos na mesma transação:
//   pedidos/{id}         — completo (nome, telefone, endereço...): só o restaurante lê
//   acompanhamento/{id}  — público, SEM dados pessoais: é o que o cliente vê em /pedido
//
// O {id} (código secreto do link de acompanhamento) é gerado AQUI, derivado da "chave" de reenvio que o
// navegador manda (campo "chave"; "pedidoId" ainda é aceito por compatibilidade com páginas antigas em cache).
// O navegador nunca escolhe o código; a resposta traz o código para o cliente abrir /pedido.

const { FieldValue } = require("firebase-admin/firestore");
const {
  ErroPedido, iniciarFirebase, hash, idPublicoDoPedido, emSegundoPlano,
  ipDoCliente, origemDe, texto, lerCorpo, moeda, enviarAviso
} = require("./_comum");
const { gravarResumo } = require("./_status");
const { diaSP } = require("./_status-regras");

const FUSO = "America/Sao_Paulo";
const FORMAS_PAGAMENTO = ["dinheiro", "cartao", "pix"];
const ID_RE = /^[A-Za-z0-9]{1,64}$/;
const PEDIDO_ID_RE = /^[A-Za-z0-9]{20,40}$/;
const JANELA_MS = 10 * 60 * 1000;     // janela dos limites contra abuso
const MAX_PEDIDOS_TELEFONE = 5;       // por telefone, a cada 10 minutos
const MAX_PEDIDOS_IP = 12;            // por IP, a cada 10 minutos (vários clientes podem dividir o mesmo Wi-Fi)
const JANELA_PENDENTES_MS = 30 * 60 * 1000;
const MAX_NOVOS_PENDENTES = 15;       // pedidos "novos" sem resposta nos últimos 30 minutos
const MAX_POR_ITEM = 20;
const MAX_UNIDADES = 60;
const LIMITE_TOTAL_CENTAVOS = 2000000; // R$ 20.000,00

// ---------- Horário de funcionamento (fuso de Brasília) ----------
// ATENÇÃO: mesma regra de statusRestaurante() em js/cliente.js. Se mudar uma, mude a outra.
function paraMinutos(hhmm) {
  const [h, m] = String(hhmm || "").split(":").map(Number);
  return Number.isInteger(h) && Number.isInteger(m) ? h * 60 + m : null;
}

function minutosAgora() {
  const partes = new Intl.DateTimeFormat("pt-BR", {
    timeZone: FUSO, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date());
  const h = Number(partes.find((p) => p.type === "hour").value);
  const m = Number(partes.find((p) => p.type === "minute").value);
  return h * 60 + m;
}

function dentroDoHorario(abertura, fechamento) {
  const a = paraMinutos(abertura);
  const f = paraMinutos(fechamento);
  if (a === null || f === null) return false;
  if (a === f) return true; // 24 horas
  const n = minutosAgora();
  return a < f ? n >= a && n < f : n >= a || n < f;
}

// Conta mais um pedido na janela de 10 minutos. Estoura o limite -> erro 429.
function contarJanela(snap, agora, maximo, mensagem) {
  let janelaInicio = agora;
  let contagem = 1;
  if (snap.exists) {
    const limite = snap.data();
    if (agora - Number(limite.janelaInicio) < JANELA_MS) {
      janelaInicio = Number(limite.janelaInicio);
      contagem = Number(limite.contagem) + 1;
      if (contagem > maximo) throw new ErroPedido(429, mensagem);
    }
  }
  return { janelaInicio, contagem };
}

async function criarPedido(db, corpo, ip) {
  // ----- Dados enviados pelo cliente (tudo é validado de novo aqui) -----
  const restauranteId = String(corpo.restauranteId || "");
  if (!ID_RE.test(restauranteId)) throw new ErroPedido(400, "Restaurante inválido.");

  // Chave de reenvio vinda do navegador (só evita pedido duplicado). O código público é derivado dela no servidor.
  const chave = String(corpo.chave || corpo.pedidoId || "");
  if (!PEDIDO_ID_RE.test(chave)) throw new ErroPedido(400, "Código do pedido inválido. Recarregue a página.");
  const pedidoId = idPublicoDoPedido(restauranteId, chave);

  if (!Array.isArray(corpo.itens) || corpo.itens.length < 1 || corpo.itens.length > 40) {
    throw new ErroPedido(400, "O carrinho está vazio ou grande demais.");
  }
  // Soma as quantidades por produto (o mesmo produto pode vir em linhas repetidas)
  const quantidades = new Map();
  for (const item of corpo.itens) {
    const produtoId = String((item && item.produtoId) || "");
    const quantidade = item && item.quantidade;
    if (!ID_RE.test(produtoId) || !Number.isInteger(quantidade) || quantidade < 1 || quantidade > MAX_POR_ITEM) {
      throw new ErroPedido(400, "Item inválido no carrinho.");
    }
    quantidades.set(produtoId, (quantidades.get(produtoId) || 0) + quantidade);
  }
  let unidades = 0;
  for (const q of quantidades.values()) {
    if (q > MAX_POR_ITEM) throw new ErroPedido(400, `Máximo de ${MAX_POR_ITEM} unidades por item.`);
    unidades += q;
  }
  if (unidades > MAX_UNIDADES) throw new ErroPedido(400, "Quantidade de itens acima do permitido.");

  const cliente = corpo.cliente || {};
  const entrega = corpo.entrega || {};
  const pagamento = corpo.pagamento || {};
  const nome = texto(cliente.nome, "nome", 2, 60);
  const telefone = String(cliente.telefone == null ? "" : cliente.telefone).replace(/\D/g, "");
  if (telefone.length !== 10 && telefone.length !== 11) {
    throw new ErroPedido(400, "Telefone inválido. Informe o DDD e o número.");
  }
  const endereco = texto(entrega.endereco, "endereço", 5, 160);
  const referencia = texto(entrega.referencia, "referência", 0, 80);
  const observacao = texto(corpo.observacao, "observação", 0, 200);

  const forma = String(pagamento.forma || "");
  if (!FORMAS_PAGAMENTO.includes(forma)) throw new ErroPedido(400, "Escolha a forma de pagamento.");
  let trocoPara = null;
  if (forma === "dinheiro" && pagamento.trocoParaCentavos != null) {
    const valor = pagamento.trocoParaCentavos;
    if (!Number.isInteger(valor) || valor <= 0 || valor > LIMITE_TOTAL_CENTAVOS) {
      throw new ErroPedido(400, "Valor do troco inválido.");
    }
    trocoPara = valor;
  }
  const totalEsperado = Number.isInteger(corpo.totalEsperadoCentavos) ? corpo.totalEsperadoCentavos : null;

  // ----- Referências -----
  const restRef = db.collection("restaurantes").doc(restauranteId);
  const pedidoRef = restRef.collection("pedidos").doc(pedidoId);
  const acompRef = restRef.collection("acompanhamento").doc(pedidoId);
  const contadorRef = restRef.collection("contadores").doc("pedidos");
  const limiteTelRef = db.collection("_limites").doc("tel_" + hash(telefone));
  const limiteIpRef = db.collection("_limites").doc("ip_" + hash(ip));
  const produtoRefs = [...quantidades.keys()].map((id) => restRef.collection("produtos").doc(id));

  // ----- Tudo em uma transação: lê preços atuais, confere regras e grava o pedido -----
  return db.runTransaction(async (t) => {
    const [restSnap, pedidoSnap, contadorSnap, limiteTelSnap, limiteIpSnap, ...produtoSnaps] =
      await t.getAll(restRef, pedidoRef, contadorRef, limiteTelRef, limiteIpRef, ...produtoRefs);

    // Mesmo código de pedido enviado de novo (rede ruim): devolve o pedido já criado, sem duplicar
    if (pedidoSnap.exists) {
      const antigo = pedidoSnap.data();
      return { duplicado: true, pedidoId, numero: antigo.numero, totalCentavos: antigo.totalCentavos };
    }

    if (!restSnap.exists || restSnap.data().ativo !== true) {
      throw new ErroPedido(404, "Restaurante não encontrado ou indisponível.");
    }
    const rest = restSnap.data();
    if (rest.aberto !== true || !dentroDoHorario(rest.horarioAbertura, rest.horarioFechamento)) {
      throw new ErroPedido(409, "O restaurante está fechado no momento.", { codigo: "fechado" });
    }

    // ----- Proteção contra abuso -----
    const agora = Date.now();
    const janelaTel = contarJanela(limiteTelSnap, agora, MAX_PEDIDOS_TELEFONE,
      "Muitos pedidos em pouco tempo. Aguarde alguns minutos e tente de novo.");
    const janelaIp = contarJanela(limiteIpSnap, agora, MAX_PEDIDOS_IP,
      "Muitos pedidos vindos desta conexão. Aguarde alguns minutos e tente de novo.");

    // Muitos pedidos "novos" sem resposta nos últimos 30 min: o restaurante não está dando conta
    // (ou alguém está inundando o painel). Só olha pedidos recentes, então testes antigos não travam nada.
    const recentes = await t.get(restRef.collection("pedidos")
      .where("criadoEm", ">=", new Date(agora - JANELA_PENDENTES_MS)).limit(60));
    const pendentes = recentes.docs.filter((d) => d.data().status === "novo").length;
    if (pendentes >= MAX_NOVOS_PENDENTES) {
      throw new ErroPedido(429, "O restaurante está com muitos pedidos aguardando confirmação. Tente de novo em alguns minutos.", {
        codigo: "muitos_pendentes"
      });
    }

    // Produtos: precisam existir, estar ativos (não arquivados) e disponíveis (não pausados)
    const naoDisponiveis = [];
    const linhas = [];
    produtoSnaps.forEach((snap, i) => {
      const produtoId = produtoRefs[i].id;
      const p = snap.exists ? snap.data() : null;
      if (!p || p.ativo !== true || p.disponivel !== true || !Number.isInteger(p.precoCentavos) || p.precoCentavos <= 0) {
        naoDisponiveis.push(produtoId);
        return;
      }
      linhas.push({
        produtoId, nome: p.nome, precoCentavos: p.precoCentavos,
        quantidade: quantidades.get(produtoId), categoriaId: p.categoriaId
      });
    });

    // A categoria do produto também precisa estar ativa (senão ele nem aparece no cardápio)
    const categoriaIds = [...new Set(linhas.map((l) => l.categoriaId))];
    const categoriasInativas = new Set();
    if (categoriaIds.length) {
      const catSnaps = await t.getAll(...categoriaIds.map((id) => restRef.collection("categorias").doc(id)));
      catSnaps.forEach((snap) => {
        if (!snap.exists || snap.data().ativo !== true) categoriasInativas.add(snap.id);
      });
    }
    const validas = [];
    for (const linha of linhas) {
      if (categoriasInativas.has(linha.categoriaId)) naoDisponiveis.push(linha.produtoId);
      else validas.push(linha);
    }
    if (naoDisponiveis.length) {
      throw new ErroPedido(409, "Alguns itens não estão mais disponíveis.", {
        codigo: "produto_indisponivel", produtoIds: naoDisponiveis
      });
    }

    // Preços SEMPRE vêm do Firestore
    const itens = validas.map((l) => ({
      produtoId: l.produtoId, nome: l.nome, precoCentavos: l.precoCentavos,
      quantidade: l.quantidade, subtotalCentavos: l.precoCentavos * l.quantidade
    }));
    const subtotal = itens.reduce((soma, i) => soma + i.subtotalCentavos, 0);
    const taxa = Number.isInteger(rest.taxaEntregaCentavos) ? rest.taxaEntregaCentavos : 0;
    const total = subtotal + taxa;
    if (total > LIMITE_TOTAL_CENTAVOS) throw new ErroPedido(400, "Pedido acima do limite permitido.");
    if (totalEsperado !== null && totalEsperado !== total) {
      throw new ErroPedido(409, "Os preços mudaram. Confira o novo total antes de enviar.", {
        codigo: "preco_mudou", totalCentavos: total
      });
    }
    if (trocoPara !== null && trocoPara < total) {
      throw new ErroPedido(400, "O valor do troco precisa ser maior ou igual ao total do pedido.");
    }

    // ----- Gravações (só depois de todas as leituras) -----
    const numero = (contadorSnap.exists ? Number(contadorSnap.data().ultimo) || 0 : 0) + 1;
    t.set(contadorRef, { ultimo: numero });
    t.set(limiteTelRef, { janelaInicio: janelaTel.janelaInicio, contagem: janelaTel.contagem, atualizadoEm: FieldValue.serverTimestamp() });
    t.set(limiteIpRef, { janelaInicio: janelaIp.janelaInicio, contagem: janelaIp.contagem, atualizadoEm: FieldValue.serverTimestamp() });

    // Pedido completo: só o restaurante lê.
    // resumoContado: este pedido entra no resumo diário (pedidos antigos, sem a marca, ficam de fora).
    // resumoDia: o dia (Brasília) do resumo onde ele foi contado; entrega e cancelamento somam no mesmo dia.
    const criadoEmData = new Date();
    const resumoDia = diaSP(criadoEmData);
    t.create(pedidoRef, {
      numero,
      status: "novo",
      restauranteId,
      restauranteNome: rest.nome,
      itens,
      subtotalCentavos: subtotal,
      taxaEntregaCentavos: taxa,
      totalCentavos: total,
      cliente: { nome, telefone },
      entrega: { endereco, referencia },
      observacao,
      pagamento: { forma, trocoParaCentavos: trocoPara },
      cancelamentoSolicitado: false,
      resumoContado: true,
      resumoDia,
      criadoEm: FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp()
    });
    gravarResumo(t, restRef, { resumoContado: true, resumoDia }, { tipo: "criado" }, criadoEmData);

    // Acompanhamento público: sem telefone, sem endereço, sem observação
    t.create(acompRef, {
      numero,
      status: "novo",
      restauranteNome: rest.nome,
      primeiroNome: nome.split(" ")[0].slice(0, 30),
      itens: itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, subtotalCentavos: i.subtotalCentavos })),
      subtotalCentavos: subtotal,
      taxaEntregaCentavos: taxa,
      totalCentavos: total,
      pagamento: { forma, trocoParaCentavos: trocoPara },
      cancelamentoSolicitado: false,
      criadoEm: FieldValue.serverTimestamp(),
      atualizadoEm: FieldValue.serverTimestamp()
    });
    return { duplicado: false, pedidoId, numero, totalCentavos: total };
  });
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ erro: "Método não permitido." });
  }
  try {
    const db = iniciarFirebase();
    const corpo = lerCorpo(req);
    const resultado = await criarPedido(db, corpo, ipDoCliente(req));
    if (!resultado.duplicado) {
      // Avisa o celular do restaurante (mesmo com o app fechado). Na Vercel, o aviso segue em segundo plano
      // enquanto o cliente já recebe a resposta; sem waitUntil, espera terminar antes de responder.
      // Nunca derruba o pedido: erros do aviso só vão para o log.
      await emSegundoPlano(enviarAviso(db, String(corpo.restauranteId), `Novo pedido #${resultado.numero}`,
        `Total ${moeda(resultado.totalCentavos)}. Toque para abrir.`, origemDe(req)));
    }
    return res.status(resultado.duplicado ? 200 : 201).json({ ok: true, ...resultado });
  } catch (erro) {
    if (erro instanceof ErroPedido) {
      return res.status(erro.status).json({ erro: erro.message, ...erro.extra });
    }
    console.error("criar-pedido:", erro);
    return res.status(500).json({ erro: "Não foi possível registrar o pedido. Tente novamente." });
  }
};
