// Deu Fome — Firebase Admin FALSO, só para testes das funções /api sem emulador nem internet.
// Troca os módulos "firebase-admin/*" e "@vercel/functions" por versões em memória (via Module._load),
// então o código real de api/*.js roda do jeito que está. Não valida regras de segurança (isso é do
// regras.test.mjs, no emulador): serve para conferir a LÓGICA das transações e do resumo diário.
//
// Uso nos testes: require("./_firebase-falso.cjs") ANTES de carregar qualquer api/*.js.

const Module = require("module");

class Ts {
  constructor(ms) { this.ms = ms; }
  toDate() { return new Date(this.ms); }
  toMillis() { return this.ms; }
}

const ehOp = (v) => v && typeof v === "object" && typeof v.__op === "string";
const ehPlano = (v) => v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Ts) && !(v instanceof Date) && !ehOp(v);

function clonar(v) {
  if (Array.isArray(v)) return v.map(clonar);
  if (ehPlano(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clonar(x)]));
  return v;
}

// Aplica "novo" sobre "existente". merge=true: mapas aninhados são mesclados (como set com merge).
function aplicar(existente, novo, merge) {
  const saida = clonar(existente || {});
  for (const [k, v] of Object.entries(novo)) {
    if (ehOp(v)) {
      if (v.__op === "inc") saida[k] = (Number(saida[k]) || 0) + v.n;
      else if (v.__op === "ts") saida[k] = new Ts(Date.now());
    } else if (ehPlano(v)) {
      saida[k] = aplicar(merge && ehPlano(saida[k]) ? saida[k] : {}, v, merge);
    } else {
      saida[k] = clonar(v);
    }
  }
  return saida;
}

const dados = new Map(); // caminho -> objeto

class Snap {
  constructor(ref, valor) { this.ref = ref; this.id = ref.id; this.exists = valor !== undefined; this._v = valor; }
  data() { return this._v === undefined ? undefined : clonar(this._v); }
}

class Consulta {
  constructor(colecao) { this.colecao = colecao; this.max = Infinity; }
  where() { return this; }
  orderBy() { return this; }
  limit(n) { this.max = n; return this; }
  async get() {
    const prefixo = this.colecao.path + "/";
    const docs = [];
    for (const [caminho, valor] of dados) {
      if (caminho.startsWith(prefixo) && !caminho.slice(prefixo.length).includes("/")) {
        docs.push(new Snap(new Doc(caminho), valor));
      }
    }
    return { docs: docs.slice(0, this.max), size: Math.min(docs.length, this.max) };
  }
}

class Colecao {
  constructor(caminho) { this.path = caminho; this.id = caminho.split("/").pop(); }
  doc(id) { return new Doc(`${this.path}/${id}`); }
  where() { return new Consulta(this); }
  orderBy() { return new Consulta(this); }
  limit(n) { return new Consulta(this).limit(n); }
  get() { return new Consulta(this).get(); }
}

class Doc {
  constructor(caminho) { this.path = caminho; this.id = caminho.split("/").pop(); }
  collection(nome) { return new Colecao(`${this.path}/${nome}`); }
  async get() { return new Snap(this, dados.get(this.path)); }
}

const db = {
  collection: (nome) => new Colecao(nome),
  async runTransaction(fn) {
    const escritas = [];
    const t = {
      async getAll(...refs) { return refs.map((r) => new Snap(r, dados.get(r.path))); },
      async get(alvo) { return alvo instanceof Consulta ? alvo.get() : new Snap(alvo, dados.get(alvo.path)); },
      set(ref, valor, opcoes) { escritas.push(() => dados.set(ref.path, aplicar(opcoes && opcoes.merge ? dados.get(ref.path) : {}, valor, !!(opcoes && opcoes.merge)))); },
      create(ref, valor) { escritas.push(() => { if (dados.has(ref.path)) throw new Error("já existe: " + ref.path); dados.set(ref.path, aplicar({}, valor, false)); }); },
      update(ref, valor) { escritas.push(() => { if (!dados.has(ref.path)) throw new Error("não existe: " + ref.path); dados.set(ref.path, aplicar(dados.get(ref.path), valor, false)); }); },
      delete(ref) { escritas.push(() => dados.delete(ref.path)); }
    };
    const resultado = await fn(t);
    escritas.forEach((e) => e()); // só aplica se a função terminou sem erro (como a transação real)
    return resultado;
  }
};

// Atalhos para os testes
const banco = {
  db,
  limpar: () => dados.clear(),
  gravar: (caminho, valor) => dados.set(caminho, aplicar({}, valor, false)),
  ler: (caminho) => (dados.has(caminho) ? clonar(dados.get(caminho)) : undefined),
  caminhos: () => [...dados.keys()]
};

const mocks = {
  "firebase-admin/app": { initializeApp: () => ({}), cert: (c) => c, getApps: () => [{}] },
  "firebase-admin/firestore": {
    getFirestore: () => db,
    FieldValue: {
      increment: (n) => ({ __op: "inc", n }),
      serverTimestamp: () => ({ __op: "ts" })
    }
  },
  // O "token" do teste é o próprio UID. "invalido" simula sessão expirada.
  "firebase-admin/auth": {
    getAuth: () => ({
      async verifyIdToken(token) {
        if (!token || token === "invalido") throw new Error("token inválido");
        return { uid: token };
      }
    })
  },
  "firebase-admin/messaging": { getMessaging: () => ({ sendEachForMulticast: async () => ({ responses: [] }) }) },
  "@vercel/functions": { waitUntil: () => {} }
};

const original = Module._load;
Module._load = function (pedido, ...resto) {
  if (Object.prototype.hasOwnProperty.call(mocks, pedido)) return mocks[pedido];
  return original.call(this, pedido, ...resto);
};

// Conta de serviço de mentira: só precisa ter private_key para iniciarFirebase() aceitar
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ private_key: "chave-de-teste-nao-secreta", client_email: "teste@exemplo.com" });

// Requisição/resposta de mentira no formato das funções da Vercel
function chamar(handler, { corpo = {}, token, metodo = "POST", ip = "1.2.3.4" } = {}) {
  const req = { method: metodo, body: corpo, headers: { "x-forwarded-for": ip, host: "deufome.test" } };
  if (token) req.headers.authorization = `Bearer ${token}`;
  return new Promise((resolve, reject) => {
    const res = {
      cabecalhos: {},
      setHeader(k, v) { this.cabecalhos[k] = v; },
      status(c) { this.codigo = c; return this; },
      json(o) { this.corpo = o; resolve({ codigo: this.codigo, corpo: o }); return this; }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

module.exports = { banco, chamar, Ts };
