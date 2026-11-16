// Deu Fome — service worker dos avisos push (Firebase Cloud Messaging).
// Fica na raiz do site para poder receber avisos mesmo com o app/aba fechados.
// Quando chega uma notificação, o próprio SDK mostra o aviso e, ao tocar, abre o link do painel de pedidos.

importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyB39VIqF1uG_V7qqAHdKU4yTe0900jRs7o",
  authDomain: "deu-fome-fd2e8.firebaseapp.com",
  projectId: "deu-fome-fd2e8",
  storageBucket: "deu-fome-fd2e8.firebasestorage.app",
  messagingSenderId: "620829388215",
  appId: "1:620829388215:web:220cec303d26f2da3c0c32"
});

firebase.messaging();
