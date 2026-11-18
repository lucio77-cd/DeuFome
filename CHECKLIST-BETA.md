# Checklist do beta — 1 restaurante, 1 semana

Marque cada item no celular. Só começa a semana real quando as partes 1 a 4 estiverem completas.

## 1. Antes de tudo (uma vez só)

- [ ] O último deploy na Vercel está **verde** (Deployments → o mais recente com "Ready").
- [ ] Variável `FIREBASE_SERVICE_ACCOUNT` está na Vercel (Settings → Environment Variables).
- [ ] **Depois** do deploy verde: copie o `firestore.rules` do GitHub (branch `main`) para Firebase Console → Firestore Database → **Regras** → **Publicar**.
- [ ] Firebase Authentication → Settings → **Authorized domains** tem o endereço do site (o da Vercel e, se tiver, o domínio próprio).
- [ ] Firebase Authentication → Sign-in method → **Google** está **ativado** (sem isso o cliente não consegue entrar nem pedir).
- [ ] O Mestre criou o restaurante piloto, o login do dono (Authentication) e o vínculo (README, passo a passo do Mestre).
- [ ] Cardápio real cadastrado: categorias, todos os produtos, preços, **taxa de entrega** e **horário**.
- [ ] Restaurante aberto e dentro do horário.

## 2. Teste completo no celular (15 minutos)

Use dois aparelhos, ou o mesmo com a janela anônima para o cliente.

- [ ] Cliente: abre o site, escolhe o restaurante, adiciona itens, **fecha o navegador e abre de novo** → o carrinho continua.
- [ ] Cliente: no carrinho aparece **Entrar com o Google** (o formulário só abre depois de entrar). Entrar com uma conta Google comum e confirmar que o nome vem preenchido.
- [ ] Cliente: marcar "Ajude o restaurante", preencher bairro, faixa etária e como conheceu, e enviar. Fazer outro pedido **sem marcar** → nada disso é enviado.
- [ ] Cliente: abrir **Meus pedidos** → os pedidos aparecem com o status. Abrir o link de **Privacidade** do carrinho.
- [ ] Cliente: na tela do pedido, **Cancelar pedido** enquanto está "Pedido recebido"; depois, com outro pedido já "Em preparo", **Pedir cancelamento** → no painel aparece "O cliente pediu o cancelamento".
- [ ] Testar o cliente em **janela anônima** (ou outro navegador) enquanto o painel do restaurante fica aberto. No iPhone, abrir pelo Safari (o login por janela pode falhar no app instalado na tela inicial).
- [ ] Cliente: envia o pedido pagando em **dinheiro com troco**, depois outro em **Pix** e outro em **cartão**.
- [ ] Painel: o pedido aparece em até alguns segundos, com som e aviso na tela.
- [ ] Painel: avançar **Aceitar → Saiu para entrega → Entregue**. O cliente vê cada mudança sem recarregar.
- [ ] Painel: **cancelar** um pedido com motivo → o cliente vê o motivo.
- [ ] Painel: botão **Imprimir** → sai só aquele pedido, em uma página.
- [ ] Cliente: abrir o carrinho com o restaurante **fechado** (desmarque "Aceitando pedidos agora") → não deixa enviar.
- [ ] Tocar duas vezes rápido em "Enviar pedido" → cria **um** pedido só.

## 3. Segurança (10 minutos)

- [ ] O link de acompanhamento do cliente **não mostra telefone nem endereço**.
- [ ] Entrar com outra conta de restaurante → **não** vê os pedidos do piloto.
- [ ] Sem login, `/painel/pedidos` mostra só o pedido de entrar.
- [ ] Mudar o status de um pedido continua funcionando depois de publicar as regras novas.
- [ ] Publicar as regras novas do `firestore.rules` (inclui `clientes/{uid}/pedidos`) e conferir que **Meus pedidos** carrega só para quem está logado.
- [ ] Depois de entregar pedidos de teste, abrir `/painel/dashboard` → **Dias da semana**, **Combinações mais pedidas** e **Perfil dos clientes** mostram os números (o perfil só conta pedidos entregues cujo cliente consentiu).

## 4. Painel instalado e avisos

- [ ] **Android (Chrome):** menu ⋮ → **Instalar app** (ou "Adicionar à tela inicial").
- [ ] **iPhone (Safari):** Compartilhar → **Adicionar à Tela de Início**. Abrir o Deu Fome **por esse ícone** (o iPhone só recebe avisos assim).
- [ ] Em Pedidos, tocar em **Ativar avisos** e permitir.
- [ ] Fechar o app por completo, fazer um pedido de outro aparelho → o celular **toca**.
- [ ] Deixar o celular do restaurante **carregando** e com o volume alto durante o expediente.

## 5. Durante a semana

Anote todo dia (um caderno ou o WhatsApp do dono serve):

| O que anotar | Por quê |
|---|---|
| Quantos pedidos pelo app | mede se o cliente usa |
| Pedido que chegou sem avisar / atrasou | testa o push |
| Cliente que reclamou ou não conseguiu pedir | acha problema de tela |
| Pedido errado (preço, taxa, item) | testa a conta do servidor |
| O que o dono sentiu falta | decide o que vem depois |

**Plano B se algo falhar:** o dono desmarca "Aceitando pedidos agora" e atende pelo WhatsApp como antes. Nenhum pedido se perde, porque o app só mostra o que o servidor gravou.

## 6. Como saber se deu certo (sugestão de metas)

- [ ] Nenhum pedido perdido (todo pedido que o cliente enviou apareceu no painel).
- [ ] O aviso chegou com o app fechado na maioria dos pedidos.
- [ ] Nenhum preço ou total errado.
- [ ] O dono quer continuar usando depois da semana.

## 7. No fim da semana

- [ ] Conversar 15 minutos com o dono: o que ajudou, o que atrapalhou.
- [x] Custo, cupons e dashboard já estão prontos (`/painel/custos`, `/painel/cupons`, `/painel/dashboard`). Peça ao dono: cadastrar ingredientes e receitas, criar 1 cupom de porcentagem (ex.: BEMVINDO10) e testar com 2 celulares o uso do **último** cupom do limite.
- [ ] Revisar o `PLANO-PAGO.md` antes de abrir para o restaurante 2.
