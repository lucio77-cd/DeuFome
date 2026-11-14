# Deu Fome 🍔

Aplicativo beta de pedidos para Treze Tílias (SC), com HTML/CSS/JavaScript, Firebase Authentication, Cloud Firestore e Vercel.

## Etapa 1 — Painéis e isolamento por restaurante

- `admin/`: painel do Mestre da plataforma.
- `painel/`: painel do responsável pelo restaurante.
- `js/firebase-config.js`: configuração Firebase Web.
- `js/admin.js`: cadastro e listagem de restaurantes.
- `js/painel.js`: configurações, categorias e produtos.
- `firestore.rules`: isolamento por restaurante.

### Preparação no Firebase

1. Em Authentication → Sign-in method, habilite E-mail/senha.
2. Em Authentication → Users, crie a conta de cada restaurante.
3. Copie o UID do usuário criado.
4. Publique o conteúdo atual de `firestore.rules` em Firestore Database → Rules.
5. Acesse `/admin` com a conta cujo UID está definido como Mestre nas regras.
6. Cadastre o nome do restaurante e cole o UID do responsável.
7. O responsável entra em `/painel` com seu e-mail e senha.

### Modelo de dados

```
restaurantes/{restauranteId}
  nome, ownerUid, ativo, criadoEm, atualizadoEm
restaurantes/{restauranteId}/configuracoes/geral
  nomePublico, horario, taxaEntregaCentavos, aberto
restaurantes/{restauranteId}/categorias/{categoriaId}
  nome, criadoEm, atualizadoEm
restaurantes/{restauranteId}/produtos/{produtoId}
  nome, descricao, categoriaId, precoCentavos, disponivel, criadoEm, atualizadoEm
```

Valores monetários são armazenados em centavos. O painel do restaurante consulta apenas documentos cujo `ownerUid` corresponde ao UID autenticado; as regras validam esse vínculo no Firestore. Assim, restaurantes não podem ler nem alterar dados uns dos outros.

### Limites desta etapa

- A criação das contas de restaurante é manual no Firebase Authentication. Automatizar isso exige função de servidor com Firebase Admin SDK.
- As regras negam as antigas coleções globais; esta versão usa apenas caminhos por restaurante.
- Ainda não há cardápio público, pedidos, pagamento ou validação de preço no servidor.
- A configuração Firebase Web é pública por natureza. Nunca coloque credenciais privadas ou service account no navegador.

### Teste de isolamento

1. Crie duas contas de teste em Authentication.
2. Cadastre dois restaurantes no painel Mestre, cada um com seu UID.
3. Na conta A, crie categorias e produtos.
4. Entre com a conta B: os dados da conta A não devem aparecer.
5. Tente acessar os caminhos do outro restaurante: as regras devem negar.

## Próximas etapas

- Etapa 2: cardápio público, carrinho e experiência do cliente.
- Etapa 3: criação segura de pedidos no servidor.
- Etapa 4: operação de pedidos em tempo real.
- Etapas seguintes: custos, cupons, indicadores e beta real.
