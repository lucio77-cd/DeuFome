// Deu Fome — bloco de conta na praça: "Entrar com o Google" (única forma de cliente criar conta) / Olá, Nome.
import { $, executar, mensagemErroFirebase } from "./utils.js";
import { aoMudarLogin, entrarComGoogle, sairDaConta } from "./cliente-auth.js";

aoMudarLogin((user) => {
  $("#contaSaiu").classList.toggle("oculto", !!user);
  $("#contaEntrou").classList.toggle("oculto", !user);
  if (user) {
    $("#loginMsg").textContent = "";
    $("#nomeGoogle").textContent = (user.displayName || "").split(" ")[0] || "bem-vindo";
  }
});

$("#entrarGoogle").addEventListener("click", (evento) => {
  executar(evento.currentTarget, async () => {
    $("#loginMsg").textContent = "";
    try { await entrarComGoogle(); } catch (erro) { $("#loginMsg").textContent = mensagemErroFirebase(erro); }
  });
});
$("#sairConta").addEventListener("click", () => { sairDaConta().catch(() => {}); });
