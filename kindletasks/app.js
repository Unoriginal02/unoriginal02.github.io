import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore, collection, addDoc,
  onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// ⚠️ REEMPLAZA ESTE BLOQUE CON TU PROPIO firebaseConfig
const firebaseConfig = {
  apiKey: "AIzaSyAlBA_fpzJvWobC3oqdZnTdzSvxDJHDwZI",
  authDomain: "unoriginal-tasks.firebaseapp.com",
  projectId: "unoriginal-tasks",
  storageBucket: "unoriginal-tasks.firebasestorage.app",
  messagingSenderId: "699262931203",
  appId: "1:699262931203:web:aac24b8fd3c5eba0ea9936"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const tareasRef = collection(db, "tareas");

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = e.target.text;
  if (input.value.trim()) {
    await addDoc(tareasRef, {
      text: input.value.trim(),
      ts: Date.now()
    });
    input.value = "";
  }
});

onSnapshot(query(tareasRef, orderBy("ts", "desc")), (snapshot) => {
  const list = document.getElementById("list");
  list.innerHTML = "";
  snapshot.forEach(doc => {
    const li = document.createElement("li");
    li.className = "list-group-item";
    li.textContent = doc.data().text;
    list.appendChild(li);
  });
});
