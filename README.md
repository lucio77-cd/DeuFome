# Deu Fome 🍔

App de pedido e entrega para Treze Tílias (SC). Versão beta com **HTML/CSS/JavaScript puro**, **Firebase** (Firestore + Auth) e deploy na **Vercel**.

## Estrutura

```
.
├── index.html            # Página inicial (placeholder da Etapa 0)
├── diagnostico.html      # Testa Firebase, regras e login do restaurante
├── css/
│   └── base.css          # Estilos base (mobile-first)
├── js/
│   ├── firebase-config.js  # Inicialização do Firebase (app, auth, db)
│   └── utils.js            # Moeda, datas, telefone, toast, erros em português
├── firestore.rules       # Regras do banco (colar no Console do Firebase)
├── vercel.json           # Cabeçalhos de segurança e URLs limpas
└── .gitignore
```

## Configuração (Etapa 0)

1. **Firebase Console** > Configurações do projeto > app da Web: copie `apiKey`, `messagingSenderId` e `appId` para `js/firebase-config.js` (campos `COLE_AQUI`).
2. **Authentication** > Método de login: ative **E-mail/senha**.
3. **Firestore Database** > Regras: cole o conteúdo de `firestore.rules` e clique em **Publicar**.
4. **Vercel**: importe este repositório (framework: *Other*, sem build). Depois adicione o domínio da Vercel em Authentication > Configurações > Domínios autorizados.
5. Abra `/diagnostico` no site e confira se todos os testes estão **OK**.

## Decisões

- Valores em dinheiro são guardados em **centavos** (inteiro).
- Projeto Firebase próprio: `deu-fome-fd2e8` (separado dos outros sistemas).
- Admin (dono do restaurante) identificado pelo UID no `firestore.rules`.
- Pedidos só são criados por usuário logado, com `clienteId` igual ao próprio UID e `status` inicial `novo`.

## Etapas

- [x] **Etapa 0** — Fundação
- [ ] Etapa 1 — Cadastro do restaurante e cardápio
- [ ] Etapa 2 — Tela do cliente e praça de alimentação
- [ ] Etapa 3 — Pedidos em tempo real
- [ ] Etapa 4 — Receitas, custos, cupons e dashboard

## Limitação conhecida

As regras garantem quem pode criar um pedido, mas não conferem o **total** nem os preços dele, porque isso não dá para validar só nas regras. Vale tratar na Etapa 3.
