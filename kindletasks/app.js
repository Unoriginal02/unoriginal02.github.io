import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc,
  doc, updateDoc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

/* ⚠️ Sustituye con tu propia configuración */
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

// Guardamos la última tarea creada para subtareas
let lastTask = { id: null, level: 0 };

/* -------- Añadir nueva tarea -------- */
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = e.target.text;
  const type  = e.target.type.value; // "task" o "subtask"
  const text  = input.value.trim();
  if (!text) return;

  // Calculamos datos de herencia
  let parentId = null;
  let level = 0;
  if (type === "subtask" && lastTask.id) {
    parentId = lastTask.id;
    level = lastTask.level + 1;
  }

  // Creamos en Firestore
  const docRef = await addDoc(tareasRef, {
    text,
    completed: false,
    ts: Date.now(),
    parentId,
    level
  });

  // Actualizamos la referencia de la última tarea creada
  lastTask = { id: docRef.id, level };

  // Limpiamos formulario y volvemos a Task
  input.value = "";
  e.target.type.value = "task";
});

/* -------- Actualizar lista en tiempo real -------- */
onSnapshot(query(tareasRef, orderBy("ts", "asc")), (snapshot) => {
  const list = document.getElementById("list");
  list.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const li   = document.createElement("li");
    li.className = "task-item";

    // Indentación según nivel
    li.style.marginLeft = `${data.level * 2}rem`;

    /* Checkbox */
    const checkbox = document.createElement("input");
    checkbox.type  = "checkbox";
    checkbox.className = "form-check-input";
    checkbox.checked   = data.completed;

    /* Texto */
    const span = document.createElement("span");
    span.textContent = data.text;
    if (data.completed) span.classList.add("completed");

    /* Botón eliminar */
    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';

    /* Eventos */
    checkbox.addEventListener("change", async () => {
      await updateDoc(doc(tareasRef, docSnap.id), { completed: checkbox.checked });
    });

    delBtn.addEventListener("click", async () => {
      await deleteDoc(doc(tareasRef, docSnap.id));
    });

    /* Montar */
    li.appendChild(checkbox);
    li.appendChild(span);
    li.appendChild(delBtn);
    list.appendChild(li);
  });
});