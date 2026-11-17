# Plano para ativar o pago

O período de testes roda nos planos gratuitos. Esta lista diz o que o código **já deixa pronto** e o que trocar quando o app passar a vender de verdade.

## Antes do beta: duas dúvidas a confirmar

1. **Uso comercial no plano gratuito da Vercel.** Um restaurante recebendo pedidos de verdade é uso comercial. O que consegui conferir na documentação pública da Vercel foram os limites de uso do plano Hobby, mas **não consegui abrir os Termos de Serviço**, onde fica a regra sobre uso comercial. Resumos de terceiros dizem que o Hobby é só para uso pessoal e não comercial. **Leia os [Termos da Vercel](https://vercel.com/legal/terms) (seção Fair Use) antes de colocar o restaurante.** Se o beta for com cliente real pagando, o mais seguro é já usar o plano Pro.
2. **Cotas do Firebase.** Confira o limite diário atual de leituras e escritas do Firestore em [firebase.google.com/pricing](https://firebase.google.com/pricing). Pela leitura do código, cada pedido novo faz até cerca de 70 leituras (quase todas da checagem de pedidos recentes, no pior caso) e poucas escritas. Para um restaurante isso sobra; para vários, vale trocar a checagem por um contador.

## O que já está pronto para o pago

| Item | Estado |
|---|---|
| Funções do servidor em São Paulo (`gru1`) | Feito (`vercel.json`) |
| Versão do Node fixada (`engines`) | Feito |
| Preço, taxa e total calculados só no servidor | Feito |
| Status do pedido só pelo servidor (base do dashboard) | Feito |
| Resumo diário para o dashboard (sem baixar todos os pedidos) | Feito |
| Regras do Firestore com testes automáticos | Feito (`tests/`) |
| Painel instalável no celular (PWA) | Feito |

## O que trocar ao ativar o pago

- [ ] **Vercel Pro** (uso comercial, mais tempo de logs, mais regras de firewall, controle de gastos).
- [ ] **Domínio próprio** (ex.: `deufome.com.br`): registrar, ligar na Vercel e adicionar em Firebase Auth → Authorized domains.
- [ ] **Firebase com cobrança ativada**, só se as cotas gratuitas ficarem curtas. Defina um **alerta de orçamento** junto.
- [ ] **Backup do banco:** agendar exportação do Firestore (precisa de cobrança ativada). Antes disso, exportar à mão uma vez por semana no beta.
- [ ] **Monitoramento de erros** nas funções (Vercel → Logs; no Pro há mais retenção).
- [ ] **Proteção contra pedido falso (captcha):** hoje qualquer pessoa pode mandar pedido com telefone inventado. A solução é uma caixinha "não sou robô" gratuita, como o **Cloudflare Turnstile**: você cria uma conta grátis no Cloudflare e ele gera duas chaves (uma pública, no site; outra secreta, só na Vercel). Fazer **antes** de divulgar o link publicamente ou de entrar o restaurante 2.
- [ ] **Termos de uso e política de privacidade** (LGPD): o app guarda nome, telefone e endereço dos clientes. Definir por quanto tempo guarda e apagar depois.
- [ ] **Restaurante 2:** o Mestre cadastra pela tela `/admin`; rodar o checklist de segurança de novo com duas contas.
- [ ] **Pagamento online (Pix, cartão):** hoje é tudo na entrega. É uma etapa nova, com provedor de pagamento.

## Fora do plano, mas combinar

- Quem atende o suporte do restaurante e em que horário.
- O que acontece com pedidos se o servidor cair (plano B: WhatsApp, ver `CHECKLIST-BETA.md`).
