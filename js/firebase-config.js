// Deu Fome — Firebase Web SDK modular (sem build).
// A configuração Web identifica o projeto; a proteção dos dados fica nas regras do Firestore.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const FIREBASE_VERSION = "10.12.2";
export const firebaseConfig = {
  apiKey: "AIzaSyB39VIqF1uG_V7qqAHdKU4yTe0900jRs7o",
  authDomain: "deu-fome-fd2e8.firebaseapp.com",
  projectId: "deu-fome-fd2e8",
  storageBucket: "deu-fome-fd2e8.firebasestorage.app",
  messagingSenderId: "620829388215",
  appId: "1:620829388215:web:220cec303d26f2da3c0c32",
  measurementId: "G-GCV527ESZD"
};
export const configPreenchida = true;
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
