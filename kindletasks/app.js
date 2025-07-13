import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  onSnapshot,
  getDocs
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

// Guarda el ID de la última tarea de primer nivel para nuevas subtareas
let lastTaskId = null;

document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = e.target.text.value.trim();
  const tipo  = document.getElementById("type-selector").value;
  if (!texto) return;

  let parentId = null;
  if (tipo === "subtask" && lastTaskId) {
    parentId = lastTaskId;
  }

  const snapshotAll = await getDocs(tareasRef);
  const docs = snapshotAll.docs.map(d => ({ id: d.id, ...d.data() }));
  const siblings = docs.filter(d => (d.parent || null) === parentId);
  const maxOrder = siblings.reduce((max, d) => d.order > max ? d.order : max, 0);

  const nuevo = {
    text: texto,
    completed: false,
    ts: Date.now(),
    order: maxOrder + 1
  };
  if (parentId) {
    nuevo.parent = parentId;
  }

  await addDoc(tareasRef, nuevo);
  e.target.text.value = "";
});

onSnapshot(tareasRef, (snapshot) => {
  const list = document.getElementById("list");
  list.innerHTML = "";

  const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
  const tasks    = docs.filter(d => !d.parent).sort((a, b) => a.order - b.order);
  const subtasks = docs.filter(d => d.parent);

  if (tasks.length) {
    lastTaskId = tasks[tasks.length - 1].id;
  }

  const moveTask = async (id, parentId, direction) => {
    const siblings = docs
      .filter(d => (d.parent || null) === parentId)
      .sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex(d => d.id === id);
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= siblings.length) return;
    const current = siblings[idx];
    const target  = siblings[targetIdx];
    await updateDoc(doc(tareasRef, current.id), { order: target.order });
    await updateDoc(doc(tareasRef, target.id),  { order: current.order });
  };

  const btnFactory = (icon, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "icon-btn";
    b.innerHTML = `<i class="bi bi-${icon}"></i>`;
    b.addEventListener("click", onClick);
    return b;
  };

  const renderCheckbox = (id, completed) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "checkbox-btn" + (completed ? " checked" : "");
    btn.innerHTML = `<i class="bi bi-check-lg"></i>`;
    btn.addEventListener("click", async () => {
      const newState = !btn.classList.contains("checked");
      btn.classList.toggle("checked", newState);
      await updateDoc(doc(tareasRef, id), { completed: newState });
    });
    return btn;
  };

  const containers = {};
  tasks.forEach(({ id, text, completed }) => {
    const li = document.createElement("li");
    li.className = "task-item";

    const contentDiv = document.createElement("div");
    contentDiv.className = "task-content";

    // checkbox
    const cb = renderCheckbox(id, completed);

    // texto
    const span = document.createElement("span");
    span.textContent = text;
    span.classList.add("task-text");
    if (completed) span.classList.add("completed");

    // controles
    const del    = btnFactory("x-lg", () => deleteDoc(doc(tareasRef, id)));
    const upBtn  = btnFactory("chevron-up", () => moveTask(id, null, "up"));
    const downBtn= btnFactory("chevron-down", () => moveTask(id, null, "down"));

    contentDiv.append(cb, span, del, upBtn, downBtn);
    li.append(contentDiv);

    const subUl = document.createElement("ul");
    subUl.className = "subtask-list";
    li.append(subUl);

    list.append(li);
    containers[id] = subUl;
  });

  tasks.forEach(task => {
    const parentUl = containers[task.id];
    const children = subtasks
      .filter(s => s.parent === task.id)
      .sort((a, b) => a.order - b.order);
    children.forEach(({ id, text, completed, parent }) => {
      const li = document.createElement("li");
      li.className = "subtask-item";

      const contentDiv = document.createElement("div");
      contentDiv.className = "task-content";

      const cb   = renderCheckbox(id, completed);
      const span = document.createElement("span");
      span.textContent = text;
      span.classList.add("task-text");
      if (completed) span.classList.add("completed");

      const del    = btnFactory("x-lg", () => deleteDoc(doc(tareasRef, id)));
      const upBtn  = btnFactory("chevron-up", () => moveTask(id, parent, "up"));
      const downBtn= btnFactory("chevron-down", () => moveTask(id, parent, "down"));

      contentDiv.append(cb, span, del, upBtn, downBtn);
      li.append(contentDiv);
      parentUl.append(li);
    });
  });
});