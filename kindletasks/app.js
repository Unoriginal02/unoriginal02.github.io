// app.js
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

// Mantiene el ID de la última tarea de nivel 1
let lastTaskId = null;

/* -------- Añadir nueva tarea/subtarea -------- */
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = e.target.text.value.trim();
  const tipo  = document.getElementById("type-selector").value;
  if (!texto) return;

  const nuevo = {
    text: texto,
    completed: false,
    ts: Date.now()
  };

  if (tipo === "subtask" && lastTaskId) {
    nuevo.parent = lastTaskId;
  }

  await addDoc(tareasRef, nuevo);
  e.target.text.value = "";
});

/* -------- Actualizar lista en tiempo real -------- */
onSnapshot(
  query(tareasRef, orderBy("ts", "asc")),
  (snapshot) => {
    const list = document.getElementById("list");
    list.innerHTML = "";

    // Separar tareas de subtareas
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const tasks    = docs.filter(d => !d.parent);
    const subtasks = docs.filter(d => d.parent);

    // Actualizar lastTaskId (última tarea creada)
    if (tasks.length) {
      lastTaskId = tasks[tasks.length - 1].id;
    }

    // Primero renderizamos las tareas de nivel 1
    const containers = {}; // parentId -> UL donde van sus subtareas
    tasks.forEach(({ id, text, completed }) => {
      const li = document.createElement("li");
      li.className = "task-item";

      // Checkbox
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "form-check-input";
      cb.checked = completed;

      // Texto
      const span = document.createElement("span");
      span.textContent = text;
      if (completed) span.classList.add("completed");

      // Botón eliminar
      const del = document.createElement("button");
      del.className = "delete-btn";
      del.innerHTML = '<i class="bi bi-x-lg"></i>';

      // Eventos
      cb.addEventListener("change", () =>
        updateDoc(doc(tareasRef, id), { completed: cb.checked })
      );
      del.addEventListener("click", () =>
        deleteDoc(doc(tareasRef, id))
      );

      // Sub-UL para subtareas
      const subUl = document.createElement("ul");
      subUl.className = "list-unstyled subtask-list";

      // Montar
      li.append(cb, span, del, subUl);
      list.appendChild(li);
      containers[id] = subUl;
    });

    // Luego las subtareas dentro de su contenedor correspondiente
    subtasks.forEach(({ id, text, completed, parent }) => {
      const parentUl = containers[parent];
      if (!parentUl) return; // si padre no existe, ignorar

      const li = document.createElement("li");
      li.className = "task-item";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "form-check-input";
      cb.checked = completed;

      const span = document.createElement("span");
      span.textContent = text;
      if (completed) span.classList.add("completed");

      const del = document.createElement("button");
      del.className = "delete-btn";
      del.innerHTML = '<i class="bi bi-x-lg"></i>';

      cb.addEventListener("change", () =>
        updateDoc(doc(tareasRef, id), { completed: cb.checked })
      );
      del.addEventListener("click", () =>
        deleteDoc(doc(tareasRef, id))
      );

      li.append(cb, span, del);
      parentUl.appendChild(li);
    });
  }
);
