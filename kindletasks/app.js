// app.js (modificado para restringir drag & drop)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc,
  doc, updateDoc, onSnapshot, query
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

let tasksList = [], subtasksList = [];
let lastTaskId = null;

// Añadir tarea o subtarea con campo 'order'
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = e.target.text.value.trim();
  const tipo  = document.getElementById("type-selector").value;
  if (!texto) return;

  const nuevo = { text: texto, completed: false, ts: Date.now() };

  if (tipo === "task") {
    const maxOrder = tasksList.length
      ? Math.max(...tasksList.map(t => t.order ?? t.ts))
      : 0;
    nuevo.order = maxOrder + 1;
  } else if (tipo === "subtask" && lastTaskId) {
    const bajo = subtasksList
      .filter(s => s.parent === lastTaskId)
      .map(s => s.order ?? s.ts);
    const maxOrderSub = bajo.length ? Math.max(...bajo) : 0;
    nuevo.order = maxOrderSub + 1;
    nuevo.parent = lastTaskId;
  }

  await addDoc(tareasRef, nuevo);
  e.target.text.value = "";
});

let taskSortable = null;
let subtaskSortables = [];

// Render y drag & drop en tiempo real
onSnapshot(query(tareasRef), (snapshot) => {
  const list = document.getElementById("list");

  // destruye Sortables previos
  if (taskSortable) taskSortable.destroy();
  subtaskSortables.forEach(s => s.destroy());
  subtaskSortables = [];

  list.innerHTML = "";

  const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  const orderVal = d => d.order !== undefined ? d.order : d.ts;

  const tasks = docs
    .filter(d => !d.parent)
    .sort((a,b) => orderVal(a) - orderVal(b));
  const subtasks = docs
    .filter(d => d.parent)
    .sort((a,b) => {
      if (a.parent !== b.parent) return a.parent.localeCompare(b.parent);
      return orderVal(a) - orderVal(b);
    });

  tasksList = tasks;
  subtasksList = subtasks;
  if (tasks.length) lastTaskId = tasks[tasks.length - 1].id;

  const containers = {};

  // Render tareas
  tasks.forEach(({ id, text, completed }) => {
    const li = document.createElement("li");
    li.className = "task-item";
    li.dataset.id = id;

    const contentDiv = document.createElement("div");
    contentDiv.className = "task-content";

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

    contentDiv.append(cb, span, del);
    li.append(contentDiv);

    const subUl = document.createElement("ul");
    subUl.className = "subtask-list";
    li.append(subUl);

    list.append(li);
    containers[id] = subUl;
  });

  // Render subtareas
  subtasks.forEach(({ id, text, completed, parent }) => {
    const parentUl = containers[parent];
    if (!parentUl) return;

    const li = document.createElement("li");
    li.className = "task-item";
    li.dataset.id = id;

    const contentDiv = document.createElement("div");
    contentDiv.className = "task-content";

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

    contentDiv.append(cb, span, del);
    li.append(contentDiv);
    parentUl.append(li);
  });

  // Sólo reordenar tareas dentro de su lista
  taskSortable = new Sortable(list, {
    animation: 150,
    handle: '.task-content',
    group: { name: 'tasks', pull: true, put: false },
    onEnd: async () => {
      Array.from(list.children).forEach((li, idx) => {
        updateDoc(doc(tareasRef, li.dataset.id), { order: idx + 1 });
      });
    }
  });

  // Sólo mover subtareas entre sublistas (no aceptan tareas)
  Object.values(containers).forEach(subUl => {
    const sortable = new Sortable(subUl, {
      group: { name: 'subtasks', pull: true, put: ['subtasks'] },
      animation: 150,
      handle: '.task-content',
      onEnd: async (evt) => {
        const movedId     = evt.item.dataset.id;
        const newParentId = evt.to.parentElement.dataset.id;

        // actualiza parent si cambió
        await updateDoc(doc(tareasRef, movedId), { parent: newParentId });

        // reordena nueva lista
        Array.from(evt.to.children).forEach((li, idx) => {
          updateDoc(doc(tareasRef, li.dataset.id), { order: idx + 1 });
        });
        // reordena lista origen si distinta
        if (evt.from !== evt.to) {
          Array.from(evt.from.children).forEach((li, idx) => {
            updateDoc(doc(tareasRef, li.dataset.id), { order: idx + 1 });
          });
        }
      }
    });
    subtaskSortables.push(sortable);
  });

});
