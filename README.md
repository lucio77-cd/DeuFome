# Deu Fome 🍔

Plataforma beta de pedidos para restaurantes de Treze Tílias (SC), construída com HTML, CSS e JavaScript modular, Firebase Authentication, Firestore e Vercel.

## Etapa 1 — Painéis e cardápio

- Área do Mestre: cadastra restaurantes e vincula o UID do responsável.
- Área do restaurante: configura nome, taxa, horário e status aberto/fechado.
- Cardápio: cadastro, edição e exclusão de categorias e produtos.
- Isolamento multi-restaurante: cada conta acessa somente os restaurantes vinculados a ela.
- Valores monetários armazenados em centavos (inteiros).

## Configuração necessária no Firebase

1. Em Authentication → Sign-in method, ative E-mail/senha.
2. Em Authentication → Users, crie a conta do responsável por cada restaurante. Copie o UID exibido no Firebase e cole no painel Mestre.
3. Publique o conteúdo de firestore.rules em Firestore Database → Regras.
4. Confira se o UID Mestre em admin/admin.js e firestore.rules corresponde à conta principal.
5. Faça deploy da branch etapa-1-painel-restaurante na Vercel para testar antes de integrar à main.

## Fluxo de cadastro

1. O Mestre entra em /admin/.
2. Cria a conta do responsável no Firebase Authentication (Console).
3. Informa o nome do restaurante e o UID do responsável no painel.
4. O painel grava restaurante, associação de membro e índice privado do usuário em uma única operação atômica.
5. O responsável entra em /painel/ e administra seu cardápio.

## Estrutura Firestore

- restaurantes/{restauranteId} — dados gerais e configurações.
- restaurantes/{restauranteId}/membros/{uid} — associação criada somente pelo Mestre.
- restaurantes/{restauranteId}/categorias/{categoriaId} — categorias do cardápio.
- restaurantes/{restauranteId}/produtos/{produtoId} — produtos e preços em centavos.
- usuarios/{uid}/restaurantes/{restauranteId} — índice privado dos restaurantes vinculados ao usuário.

As regras negam acesso às antigas coleções globais categorias e produtos. Os novos dados ficam dentro do restaurante correspondente.

## Segurança e limites desta versão

- O UID Mestre está fixado nas regras e no painel; deve corresponder à conta principal correta.
- O vínculo de usuário a restaurante só pode ser criado pelo Mestre.
- O painel não cria contas Authentication de terceiros, evitando credenciais administrativas no navegador.
- Ainda não inclui cardápio público, carrinho, pedidos, pagamentos, cupons ou API server-side.
- Antes do beta público, revisar as regras com testes no Firebase Emulator e validar o fluxo com duas contas distintas.

## Estrutura principal

- admin/ — Painel do Mestre.
- painel/ — Painel do restaurante.
- css/ — Estilos compartilhados e dos painéis.
- js/ — Configuração Firebase e utilitários.
- firestore.rules — Regras de segurança.
