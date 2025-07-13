// app.js (modificado)
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

// Guarda el ID de la última tarea de primer nivel
let lastTaskId = null;

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

onSnapshot(
  query(tareasRef, orderBy("ts", "asc")),
  (snapshot) => {
    const list = document.getElementById("list");
    list.innerHTML = "";

    const docs     = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const tasks    = docs.filter(d => !d.parent);
    const subtasks = docs.filter(d => d.parent);

    if (tasks.length) {
      lastTaskId = tasks[tasks.length - 1].id;
    }

    // Renderiza tareas de primer nivel
    const containers = {};
    tasks.forEach(({ id, text, completed }) => {
      const li = document.createElement("li");
      li.className = "task-item";

      // Fila principal
      const contentDiv = document.createElement("div");
      contentDiv.className = "task-content";

      const cb   = document.createElement("input");
      cb.type    = "checkbox";
      cb.className = "form-check-input";
      cb.checked = completed;

      const span = document.createElement("span");
      span.textContent = text;
      if (completed) span.classList.add("completed");

      const del  = document.createElement("button");
      del.className = "delete-btn";
      del.innerHTML = '<i class="bi bi-x-lg"></i>';

      cb.addEventListener("change", () =>
        updateDoc(doc(tareasRef, id), { completed: cb.checked })
      );
      del.addEventListener("click", () =>
        deleteDoc(doc(tareasRef, id))
      );

      contentDiv.append(cb, span, del);
      li.append(contentDiv);

      // Contenedor para subtareas
      const subUl = document.createElement("ul");
      subUl.className = "subtask-list";
      li.append(subUl);

      list.append(li);
      containers[id] = subUl;
    });

    // Renderiza subtareas dentro de su padre
    subtasks.forEach(({ id, text, completed, parent }) => {
      const parentUl = containers[parent];
      if (!parentUl) return;

      const li = document.createElement("li");
      li.className = "task-item";

      const contentDiv = document.createElement("div");
      contentDiv.className = "task-content";

      const cb   = document.createElement("input");
      cb.type    = "checkbox";
      cb.className = "form-check-input";
      cb.checked = completed;

      const span = document.createElement("span");
      span.textContent = text;
      if (completed) span.classList.add("completed");

      const del  = document.createElement("button");
      del.className = "delete-btn";
      del.innerHTML = '<i class="bi bi-x-lg"></i>';

      cb.addEventListener("change", () =>
        updateDoc(doc(tareasRef, id), { completed: cb.checked })
      );
      del.addEventListener("click", () =>
        deleteDoc(doc(tareasRef, id))
      );

      contentDiv.append(cb, span, del);
      li.append(contentDiv);
      parentUl.append(li);
    });
  }
);
