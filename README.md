# Deu Fome 🍔

Plataforma beta de pedidos para restaurantes de Treze Tílias (SC), construída com HTML, CSS e JavaScript modular, Firebase Authentication, Firestore e Vercel (com uma função serverless para criar pedidos).

## Etapa 1 — Painéis e cardápio

- Área do Mestre (`/admin`): cadastra restaurantes, vincula o UID do responsável e desativa/reativa restaurantes.
- Área do restaurante (`/painel`): configura nome, taxa, horário e se está aceitando pedidos.
- Cardápio: categorias e produtos. Produto não é apagado: é **arquivado** (e pode ser restaurado), para não perder o histórico dos pedidos. Também dá para **pausar** um produto (indisponível) com um toque.
- Isolamento multi-restaurante: cada conta acessa somente os restaurantes vinculados a ela.
- Valores monetários armazenados em centavos (inteiros). O campo de preço aceita `12,50`, `12.50` e `1.250,50`.

## Etapa 2 — Praça e cardápio público (sem login)

- Praça (`/`): lista os restaurantes ativos, com selo **Aberto agora / Fechado**, taxa de entrega e horário. Abertos aparecem primeiro.
- Cardápio (`/restaurante?r=ID`): categorias em ordem, produtos com preço e descrição. Produto pausado aparece como **Indisponível**; produto arquivado e categoria inativa não aparecem.
- "Aberto agora" exige o botão **Aceitando pedidos** ligado no painel **e** o horário atual (Brasília) dentro do funcionamento. Aceita a virada da meia-noite (abre 18:00, fecha 02:00). Abertura igual ao fechamento significa 24 horas.
- Restaurantes cadastrados antes da Etapa 1 que não tenham o campo `ativo` não aparecem na praça (o Mestre pode desativar e reativar para gravar o campo).

## Etapa 3 — Carrinho e pedidos

**Cliente (sem criar conta)**
- No cardápio, **Adicionar** põe o item no carrinho (guardado no aparelho). Um restaurante por vez: ao trocar de restaurante, o app pergunta antes de esvaziar o carrinho.
- `/carrinho`: altera quantidades e finaliza com nome, telefone, endereço, referência, observação e forma de pagamento (**na entrega**: dinheiro, cartão na maquininha ou Pix). Nome, telefone e endereço ficam lembrados neste aparelho para o próximo pedido.
- `/pedido?r=RESTAURANTE&p=PEDIDO`: acompanhamento em tempo real (recebido, em preparo, saiu para entrega, entregue ou cancelado). O código do pedido é aleatório e funciona como endereço secreto: quem tem o link vê o andamento, os itens e o valor, **sem telefone nem endereço** (esses ficam só no pedido completo, que só o restaurante lê).

**Restaurante**
- `/painel/pedidos`: pedidos chegando em tempo real, com aviso (mensagem, som se o navegador permitir e contador no título da aba). Botões para avançar o status (`novo → preparando → saiu para entrega → entregue`) ou cancelar. Mostra telefone, link do WhatsApp, endereço, itens, observação, pagamento e troco. **Deixe a página aberta** para receber os pedidos.

**Servidor (`api/criar-pedido.js`)**
- O navegador envia apenas IDs e quantidades. O servidor lê preço, taxa e disponibilidade no Firestore, confere se o restaurante está aberto, calcula o total e grava o pedido com o nome e o preço de cada item copiados (o histórico não muda se o cardápio mudar depois).
- Recusa produto arquivado, pausado ou de categoria inativa, e total diferente do que o cliente viu (`preco_mudou`).
- Número sequencial por restaurante (Pedido #1, #2...).
- O aparelho manda uma chave de reenvio: se a rede falhar e o cliente reenviar, o pedido **não duplica**. O código secreto do pedido (o do link de acompanhamento) é **gerado pelo servidor** a partir dessa chave com um segredo só dele; o navegador não escolhe nem adivinha o código.
- O aviso push ao restaurante segue em segundo plano (`waitUntil` da Vercel) e não atrasa a resposta ao cliente.
- Limite de **5 pedidos por telefone a cada 10 minutos**.
- As regras do Firestore **negam** a criação de pedido pelo navegador; só o servidor grava.

Ainda não inclui: pagamento online e captcha contra pedidos falsos (veja `PLANO-PAGO.md`).

## Etapa 4 — Operação em tempo real

- O restaurante muda o status **pelo servidor** (`api/atualizar-status.js`, com o login do painel): o navegador não grava mais em `pedidos` nem em `acompanhamento`. Isso mantém o resumo diário sempre correto.
- Cada pedido soma num **resumo diário** (`restaurantes/{id}/resumos/{AAAA-MM-DD}`, dia de Brasília): pedidos, entregues, cancelados, faturamento, produtos mais vendidos, horários e formas de pagamento. O dashboard lê só esses documentos.
- Botão **Imprimir** em cada pedido (impressão simples, só aquele pedido).
- Cancelamento pelo cliente (`api/cancelar-pedido.js`) também passa pelo resumo.

## Etapa 5 — Custos e margem (`/painel/custos`)

- O restaurante escolhe a unidade de cada ingrediente (g, kg, ml, l ou unidade), monta a receita de cada produto e vê lucro e margem.
- Custos ficam em `ingredientes` e `receitas`, **privados** (o cliente nunca lê).
- O servidor **copia o custo da receita para o pedido** na hora da venda. Subir o preço do queijo depois não muda o lucro dos pedidos antigos.
- Custo é guardado em "micro" (1 real = 1.000.000) porque 1 grama de ingrediente custa frações de centavo.

## Etapa 6 — Cupons (`/painel/cupons`)

- Tipos: **porcentagem** (padrão), valor fixo e frete grátis. Opções: pedido mínimo, validade, limite de usos, pausar.
- O desconto vale só sobre os produtos (nunca sobre a taxa de entrega); o frete grátis zera a taxa.
- O cliente digita o código no carrinho. `api/validar-cupom.js` mostra o desconto (limite de 20 conferências por IP a cada 10 min, para ninguém adivinhar códigos) e `api/criar-pedido.js` **confere de novo e soma o uso na mesma transação** do pedido.
- Pedido cancelado (pelo restaurante ou pelo cliente) **devolve o uso** do cupom.
- Cupons são privados; o restaurante edita as regras mas não consegue alterar o contador de usos (só o servidor).

## Configuração necessária

1. Em Authentication → Sign-in method, ative E-mail/senha.
2. Em Authentication → Users, crie a conta do responsável por cada restaurante. Copie o UID e cole no painel Mestre.
3. **Publique o conteúdo de `firestore.rules`** (`firebase deploy --only firestore:rules`, usando o `firebase.json` do projeto, ou colando em Firestore Database → Regras). Sempre que o código mudar, publique as regras junto. **Ordem importante:** primeiro o deploy do código (Vercel), depois as regras. As regras atuais negam a mudança de status direto pelo navegador; se forem publicadas antes do código novo, o painel antigo para de mudar status.
4. Confira se o UID Mestre em `js/firebase-config.js` (`MASTER_UID`) e em `firestore.rules` (função `isMaster()`) corresponde à conta principal.
5. **Chave do servidor (Etapa 3):** no Firebase Console → Configurações do projeto → Contas de serviço → **Gerar nova chave privada** (baixa um JSON). Na Vercel → Settings → Environment Variables, crie `FIREBASE_SERVICE_ACCOUNT` e cole o conteúdo inteiro do JSON. Depois faça um novo deploy. **Essa chave dá acesso total ao banco: nunca coloque no GitHub nem em mensagens.** Se o pedido falhar com "Servidor sem configuração", a variável está ausente ou inválida.
6. Faça deploy na Vercel e teste antes de divulgar. O `package.json` instala o `firebase-admin` para a função.

## Como testar (sem terminal)

1. Abra `/diagnostico` **sem login**: os três testes de bloqueio devem dar OK. Depois entre com a conta Mestre e com a de um restaurante.
2. **Praça pública:** abra `/` em aba anônima. Deve listar os restaurantes ativos.
3. **Pedido:** com o restaurante aberto (botão "Aceitando pedidos" ligado e dentro do horário), adicione produtos, vá em `/carrinho`, preencha e envie. Você deve cair em `/pedido?...` com o status "Pedido recebido".
4. **Painel:** em outra aba, entre no `/painel/pedidos` com a conta do restaurante. O pedido aparece sozinho. Avance o status e veja a página do cliente mudar.
5. **Segurança:** em um carrinho, pause o produto no `/painel` e tente enviar: deve recusar e tirar o item do carrinho. Confira também que `/pedido?r=...&p=` com um código inventado mostra "Pedido não encontrado".
6. Para conferir uma regra isolada, use o **Rules Playground** no Console do Firebase.
7. **Testes automáticos das regras** (precisam de Java e Node): `cd tests && npm install && npm test`. Eles sobem o emulador do Firestore e conferem pedido privado, acompanhamento público, custos e cupons privados, contador de usos protegido e aparelhos de push. Rode antes de publicar qualquer mudança em `firestore.rules`.
8. **Testes das funções `/api`** (sem emulador, só Node 22): `npm install && npm test`. Usam um Firestore falso em memória e conferem criar pedido, preço adulterado, cupons (limite, devolução ao cancelar), resumo diário e custos. **Não** conferem as regras de segurança (isso é o item 7).

## Fluxo de cadastro

1. O Mestre entra em `/admin/`.
2. Cria a conta do responsável no Firebase Authentication (Console).
3. Informa o nome do restaurante e o UID do responsável no painel (o UID é conferido por formato e por uma confirmação).
4. O painel grava restaurante, associação de membro e índice privado do usuário em uma única operação atômica.
5. O responsável entra em `/painel/` e administra seu cardápio e seus pedidos.
6. Para tirar o acesso de um restaurante, o Mestre usa **Desativar**: nada é apagado e dá para **Reativar** depois. Restaurante desativado some da praça.

## Estrutura Firestore

- `restaurantes/{restauranteId}` — dados gerais e configurações (`ativo` só o Mestre altera). Leitura pública só se `ativo == true`.
- `restaurantes/{restauranteId}/membros/{uid}` — associação criada somente pelo Mestre.
- `restaurantes/{restauranteId}/categorias/{categoriaId}` — categorias do cardápio (`nome`, `ativo`, `ordem`). Leitura pública só das ativas.
- `restaurantes/{restauranteId}/produtos/{produtoId}` — produtos: `nome`, `descricao`, `precoCentavos`, `categoriaId`, `disponivel`, `ativo` (falso = arquivado). Leitura pública só dos ativos.
- `restaurantes/{restauranteId}/pedidos/{pedidoId}` — pedidos (criados e alterados só pelo servidor): `numero`, `status`, `itens` (nome, preço e custo copiados), `subtotalCentavos`, `descontoCentavos`, `cupom`, `taxaEntregaCentavos`, `totalCentavos`, `custoTotalMicro`, `cliente`, `entrega`, `pagamento`, `observacao`. **Só o restaurante (e o Mestre) lê.**
- `restaurantes/{restauranteId}/ingredientes/{id}` e `receitas/{produtoId}` — custos (**privados**). `cupons/{CODIGO}` — cupons (**privados**; `usos` só o servidor altera). `resumos/{AAAA-MM-DD}` — resumo diário somado pelo servidor (o restaurante só lê).
- `restaurantes/{restauranteId}/acompanhamento/{pedidoId}` — versão pública do pedido, sem dados pessoais (`numero`, `status`, `primeiroNome`, `itens` com nome/quantidade/subtotal, valores, `pagamento`, `motivoCancelamento`). Criada junto com o pedido; o cliente lê só pelo ID (sem listagem) e o painel atualiza o status nos dois documentos no mesmo lote.
- `restaurantes/{restauranteId}/dispositivos/{token}` — aparelhos do restaurante que recebem push. O painel cadastra e remove; só o servidor lê.
- `restaurantes/{restauranteId}/contadores/pedidos` e `_limites/{hash}` — uso interno do servidor (negados ao navegador).
- `usuarios/{uid}/restaurantes/{restauranteId}` — índice privado dos restaurantes vinculados ao usuário.

As regras negam as coleções antigas e qualquer caminho não listado.

## Limites das regras

Preço até R$ 10.000,00, taxa de entrega até R$ 1.000,00, horários no formato `HH:MM` (abertura maior que fechamento significa que fecha no dia seguinte), `criadoEm`/`atualizadoEm` presos ao horário do servidor, produto só com categoria existente. Restaurantes nunca são apagados pelo app (desative em vez de excluir) e produtos só são apagados pelo Mestre. Pedido nunca é apagado nem alterado pelo navegador: o status muda pelo servidor, seguindo o andamento válido (novo, preparando, saiu para entrega, entregue; cancelar até sair entregue).

## Segurança e limites desta versão

- O UID Mestre está fixado nas regras e em `js/firebase-config.js`; no cliente ele só mostra/esconde telas.
- O vínculo de usuário a restaurante só pode ser criado pelo Mestre. O UID ainda é copiado à mão do Console: um UID inexistente passa pelas regras.
- O Mestre e o restaurante compartilham a mesma sessão do navegador.
- O documento público do restaurante inclui o campo `criadoPor` (UID do Mestre, que já aparece no código do site). Não coloque dados privados nele.
- **Pedido:** quem tem o link do pedido vê só o acompanhamento (itens, valores, status e primeiro nome), nunca telefone nem endereço. O código tem 32 caracteres, gerado pelo servidor e impossível de adivinhar, mas não compartilhe o link publicamente. Pedidos criados antes dessa versão mantêm o código antigo (de 24 caracteres) e continuam funcionando.
- **Pedidos antigos** (criados antes do acompanhamento público) não têm a versão pública: o cliente deles não vê mais o andamento, e o painel atualiza só o pedido completo.
- Limites contra abuso: 5 pedidos por telefone e 12 por IP a cada 10 minutos, no máximo 15 pedidos "novos" parados em 30 minutos, e 20 conferências de cupom por IP a cada 10 minutos. **Não há captcha**: um trote com telefones diferentes ainda é possível (veja `PLANO-PAGO.md`).
- Cada cupom pode ser usado várias vezes pela mesma pessoa; não existe "um uso por telefone" nesta versão. Use o limite total de usos para controlar o custo.
- Os preços do carrinho no aparelho servem só para exibição: o servidor recalcula tudo.
- A chave `FIREBASE_SERVICE_ACCOUNT` fica somente na Vercel.

## Estrutura principal

- `index.html` — Praça de alimentação (pública).
- `restaurante.html` — Cardápio público (`/restaurante?r=ID`).
- `carrinho.html` — Carrinho e finalização.
- `pedido.html` — Acompanhamento do pedido.
- `admin/` — Painel do Mestre. `painel/` — Painel do restaurante (`painel/pedidos.html` = pedidos recebidos).
- `diagnostico.html` — Testes de configuração, regras e isolamento.
- `api/criar-pedido.js` — Função serverless que cria o pedido (preço calculado no servidor).
- `css/` — `base.css`, `painel.css`, `cliente.css`, `pedidos.css`.
- `js/` — `firebase-config.js`, `utils.js`, `cliente.js`, `carrinho.js`, `praca.js`, `restaurante.js`, `carrinho-pagina.js`, `pedido.js`, `pedidos-painel.js`, `admin.js`, `painel.js`, `diagnostico.js`.
- `package.json` — dependência `firebase-admin` da função.
- `firestore.rules` — Regras de segurança. `firebase.json` e `firestore.indexes.json` — deploy das regras e emulador.
- `tests/` — Testes: das regras no emulador (`regras.test.mjs`, `package.json` próprio) e das funções `/api` e cálculos, sem emulador (`npm test` na raiz).
- `api/atualizar-status.js` (status pelo restaurante), `api/cancelar-pedido.js` (cancelamento pelo cliente, ainda sem tela), `api/validar-cupom.js`.
- `api/_comum.js`, `api/_id-pedido.js`, `api/_status.js`, `api/_status-regras.js`, `api/_cupom.js` — utilidades, código público do pedido, resumo diário e regras de cupom (o `_` impede a Vercel de expor como endereço).
- `painel/custos.html`, `painel/cupons.html` — custos e cupons. `js/custos.js`, `js/custo-calculo.js`, `js/cupons.js`.
- `CHECKLIST-BETA.md`, `PLANO-PAGO.md` — roteiro do beta e o que muda ao ativar o plano pago.
- `vercel.json` — Cabeçalhos de segurança (CSP sem script inline), URLs limpas e região das funções (`gru1`, São Paulo).

> As páginas públicas usam caminhos absolutos (`/js/...`, `/css/...`), que funcionam com `cleanUrls` e sem barra final. Os painéis `admin/` e `painel/` carregam os scripts com `../js/...`, e os links para `/painel/pedidos` são absolutos pelo mesmo motivo.
