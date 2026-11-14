// Deu Fome — configuração do Firebase (SDK modular via CDN, sem build)
// Preencha os valores marcados com COLE_AQUI em:
// Firebase Console > Configurações do projeto > Seus apps > App da Web > Configuração do SDK
// (a apiKey do Firebase Web não é segredo; quem protege os dados são as regras do Firestore)

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const FIREBASE_VERSION = "10.12.2";

export const firebaseConfig = {
  apiKey: "COLE_AQUI_apiKey",
  authDomain: "deu-fome-fd2e8.firebaseapp.com",
  projectId: "deu-fome-fd2e8",
  storageBucket: "deu-fome-fd2e8.firebasestorage.app",
  messagingSenderId: "COLE_AQUI_messagingSenderId",
  appId: "COLE_AQUI_appId"
};

// true quando todos os campos foram preenchidos
export const configPreenchida = !Object.values(firebaseConfig).some((v) =>
  String(v).startsWith("COLE_AQUI")
);

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
