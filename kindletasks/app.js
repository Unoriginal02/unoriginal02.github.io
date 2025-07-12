import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc,
  doc, updateDoc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

/* ⚠️ REEMPLAZA ESTOS DATOS CON TU PROPIA CONFIGURACIÓN */
const firebaseConfig = {
  apiKey: "AIzaSyAlBA_fpzJvWobC3oqdZnTdzSvxDJHDwZI",
  authDomain: "unoriginal-tasks.firebaseapp.com",
  projectId: "unoriginal-tasks",
  storageBucket: "unoriginal-tasks.appspot.com",
  messagingSenderId: "699262931203",
  appId: "1:699262931203:web:aac24b8fd3c5eba0ea9936"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const tareasRef = collection(db, "tareas");

/* ---------- AÑADIR NUEVA TAREA ---------- */
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = e.target.text;
  if (input.value.trim()) {
    await addDoc(tareasRef, {
      text: input.value.trim(),
      completed: false,
      ts: Date.now()
    });
    input.value = "";
  }
});

/* ---------- ACTUALIZAR LISTA EN TIEMPO REAL ---------- */
onSnapshot(query(tareasRef, orderBy("ts", "desc")), (snapshot) => {
  const list = document.getElementById("list");
  list.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();

    const li = document.createElement("li");
    li.className = "task-item";

    /* Checkbox */
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "form-check-input";
    checkbox.checked = data.completed;

    /* Texto */
    const span = document.createElement("span");
    span.textContent = data.text;
    if (data.completed) span.classList.add("completed");

    /* Botón eliminar (X) */
    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';

    /*  ---- Eventos ---- */
    checkbox.addEventListener("change", async () => {
      await updateDoc(doc(tareasRef, docSnap.id), { completed: checkbox.checked });
    });

    delBtn.addEventListener("click", async () => {
      await deleteDoc(doc(tareasRef, docSnap.id));
    });

    /* Montar elementos */
    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(delBtn);
    list.appendChild(li);
  });
});
