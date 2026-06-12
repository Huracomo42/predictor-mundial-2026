import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDqUe_qdbxD8anetO-OUx2zira_rqd6if0",
  authDomain: "predictor-mundial-2026-cfbfe.firebaseapp.com",
  projectId: "predictor-mundial-2026-cfbfe",
  storageBucket: "predictor-mundial-2026-cfbfe.firebasestorage.app",
  messagingSenderId: "332231440513",
  appId: "1:332231440513:web:9785102d15b602919b3580"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
