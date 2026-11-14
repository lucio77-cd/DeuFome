# Deu Fome 🍔

Plataforma beta de pedidos para restaurantes de Treze Tílias (SC), construída com HTML, CSS e JavaScript modular, Firebase Authentication, Firestore e Vercel.

## Etapa 1 — Painéis e cardápio

- Área do Mestre (`/admin`): cadastra restaurantes, vincula o UID do responsável e desativa/reativa restaurantes.
- Área do restaurante (`/painel`): configura nome, taxa, horário e se está aceitando pedidos.
- Cardápio: categorias e produtos. Produto não é apagado: é **arquivado** (e pode ser restaurado), para não perder o histórico dos pedidos da Etapa 3. Também dá para **pausar** um produto (indisponível) com um toque.
- Isolamento multi-restaurante: cada conta acessa somente os restaurantes vinculados a ela.
- Valores monetários armazenados em centavos (inteiros). O campo de preço aceita `12,50`, `12.50` e `1.250,50`.

## Etapa 2 — Praça e cardápio público (sem login)

- Praça (`/`): lista os restaurantes ativos, com selo **Aberto agora / Fechado**, taxa de entrega e horário. Abertos aparecem primeiro.
- Cardápio (`/restaurante?r=ID`): categorias em ordem, produtos com preço e descrição. Produto pausado aparece como **Indisponível**; produto arquivado e categoria inativa não aparecem.
- "Aberto agora" exige o botão **Aceitando pedidos** ligado no painel **e** o horário atual (Brasília) dentro do funcionamento. Aceita a virada da meia-noite (abre 18:00, fecha 02:00). Abertura igual ao fechamento significa 24 horas.
- Ainda **não** há carrinho nem pedido: isso é a Etapa 3.
- Restaurantes cadastrados antes da Etapa 1 que não tenham o campo `ativo` não aparecem na praça (o Mestre pode desativar e reativar para gravar o campo).

## Configuração necessária no Firebase

1. Em Authentication → Sign-in method, ative E-mail/senha.
2. Em Authentication → Users, crie a conta do responsável por cada restaurante. Copie o UID exibido no Firebase e cole no painel Mestre.
3. **Publique o conteúdo de `firestore.rules`** em Firestore Database → Regras. Sempre que o código mudar, publique as regras junto: o painel grava o campo `ativo` nos produtos, e a praça pública só funciona com as regras da Etapa 2 (sem elas, a praça mostra erro de permissão).
4. Confira se o UID Mestre em `js/firebase-config.js` (`MASTER_UID`) e em `firestore.rules` (função `isMaster()`) corresponde à conta principal.
5. Faça deploy na Vercel e teste antes de divulgar.

## Como testar (sem terminal)

1. Abra `/diagnostico` **sem login**: os três testes de bloqueio devem dar OK.
2. Entre com a conta **Mestre** no próprio diagnóstico: gravar e listar restaurantes devem dar OK.
3. Entre com a conta de **um restaurante**: gravar, listar todos os restaurantes e ler vínculos de outra conta devem ser negados, e ler o próprio índice deve ser permitido.
4. Com duas contas de restaurantes diferentes, confira que cada painel mostra só o seu cardápio.
5. **Praça pública:** abra `/` em uma aba anônima (sem login). Deve listar os restaurantes ativos. Desative um no `/admin` e atualize: ele some. Em `/painel`, arquive um produto e pause outro: no cardápio público o arquivado some e o pausado aparece como Indisponível.
6. Para conferir uma regra isolada, use o **Rules Playground** no Console do Firebase (Firestore → Regras).

## Fluxo de cadastro

1. O Mestre entra em `/admin/`.
2. Cria a conta do responsável no Firebase Authentication (Console).
3. Informa o nome do restaurante e o UID do responsável no painel (o UID é conferido por formato e por uma confirmação).
4. O painel grava restaurante, associação de membro e índice privado do usuário em uma única operação atômica.
5. O responsável entra em `/painel/` e administra seu cardápio.
6. Para tirar o acesso de um restaurante, o Mestre usa **Desativar**: nada é apagado e dá para **Reativar** depois. Restaurante desativado some da praça.

## Estrutura Firestore

- `restaurantes/{restauranteId}` — dados gerais e configurações (`ativo` só o Mestre altera). Leitura pública só se `ativo == true`.
- `restaurantes/{restauranteId}/membros/{uid}` — associação criada somente pelo Mestre.
- `restaurantes/{restauranteId}/categorias/{categoriaId}` — categorias do cardápio (`nome`, `ativo`, `ordem`). Leitura pública só das ativas.
- `restaurantes/{restauranteId}/produtos/{produtoId}` — produtos: `nome`, `descricao`, `precoCentavos`, `categoriaId`, `disponivel`, `ativo` (falso = arquivado). Leitura pública só dos ativos.
- `usuarios/{uid}/restaurantes/{restauranteId}` — índice privado dos restaurantes vinculados ao usuário (cópia do nome pode ficar velha; o painel lê o nome do restaurante).

As regras negam as antigas coleções globais (`categorias`, `produtos`, `config`...) e qualquer caminho não listado.

## Limites das regras

Preço até R$ 10.000,00, taxa de entrega até R$ 1.000,00, horários no formato `HH:MM` (abertura maior que fechamento significa que fecha no dia seguinte), `criadoEm`/`atualizadoEm` presos ao horário do servidor, produto só com categoria existente. Restaurantes nunca são apagados pelo app (desative em vez de excluir) e produtos só são apagados pelo Mestre.

## Segurança e limites desta versão

- O UID Mestre está fixado nas regras e em `js/firebase-config.js`; deve corresponder à conta principal correta. No cliente ele só mostra/esconde telas.
- O vínculo de usuário a restaurante só pode ser criado pelo Mestre.
- O painel não cria contas Authentication de terceiros, evitando credenciais administrativas no navegador. O UID ainda é copiado à mão do Console: um UID inexistente passa pelas regras (elas não consultam o Authentication). Uma função no servidor resolveria isso.
- O Mestre e o restaurante compartilham a mesma sessão do navegador: entrar em `/admin` com outra conta encerra a sessão do painel.
- O documento público do restaurante inclui o campo `criadoPor` (UID do Mestre, que já aparece no código do site). Não coloque dados privados nesse documento.
- Ainda não inclui carrinho, pedidos, pagamentos, cupons ou API server-side.
- As regras garantem quem cria um pedido, mas não conferem o total nem os preços: isso fica para a Etapa 3 (preço calculado no servidor, com o nome e o preço de cada item copiados para o pedido).
- Antes do beta público, validar o fluxo com duas contas distintas (passos acima).

## Estrutura principal

- `index.html` — Praça de alimentação (pública).
- `restaurante.html` — Cardápio público de um restaurante (`/restaurante?r=ID`).
- `admin/` — Painel do Mestre (HTML).
- `painel/` — Painel do restaurante (HTML).
- `diagnostico.html` — Testes de configuração, regras e isolamento.
- `css/` — Estilos: `base.css`, `painel.css` (painéis) e `cliente.css` (praça e cardápio).
- `js/` — Código: `firebase-config.js`, `utils.js`, `cliente.js`, `praca.js`, `restaurante.js`, `admin.js`, `painel.js`, `diagnostico.js`.
- `firestore.rules` — Regras de segurança.
- `vercel.json` — Cabeçalhos de segurança (CSP sem script inline) e URLs limpas.

> As páginas públicas novas usam caminhos absolutos (`/js/...`, `/css/...`), que funcionam com `cleanUrls` e sem barra final. Os painéis em `admin/` e `painel/` carregam os scripts com `../js/...`.
