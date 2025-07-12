import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore, collection, addDoc,
  onSnapshot, query, orderBy, updateDoc, doc
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

const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const tareasRef = collection(db, "tareas");

/* Añadir tarea */
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = e.target.text;
  if (input.value.trim()) {
    await addDoc(tareasRef, {
      text: input.value.trim(),
      ts:   Date.now(),
      done: false
    });
    input.value = "";
  }
});

/* Pintar lista y manejar cambios en tiempo real */
onSnapshot(query(tareasRef, orderBy("ts", "desc")), (snapshot) => {
  const list = document.getElementById("list");
  list.innerHTML = "";
  snapshot.forEach(d => renderItem(d));
});

function renderItem(dSnap) {
  const { text, done } = dSnap.data();
  const li  = document.createElement("li");
  li.className = "list-group-item d-flex align-items-center";

  /* Checkbox */
  const chk = document.createElement("input");
  chk.type  = "checkbox";
  chk.className = "form-check-input me-3";
  chk.checked = done;

  /* Texto */
  const span = document.createElement("span");
  span.textContent = text;
  if (done) span.classList.add("done");

  /* Toggle done */
  chk.addEventListener("change", () => {
    updateDoc(doc(tareasRef, dSnap.id), { done: chk.checked });
  });

  li.append(chk, span);
  document.getElementById("list").appendChild(li);
}