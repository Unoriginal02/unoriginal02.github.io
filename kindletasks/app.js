import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc,
  doc, updateDoc, onSnapshot, query, orderBy,
  getDocs, where, limit
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

  // Determinar parent y calcular nuevo orden
  let parentId = null;
  if (tipo === "subtask" && lastTaskId) {
    parentId = lastTaskId;
  }
  // Query para sacar el mayor order del mismo nivel
  const parentWhere = parentId
    ? where("parent", "==", parentId)
    : where("parent", "==", null);
  const q = query(tareasRef, parentWhere, orderBy("order", "desc"), limit(1));
  const snap = await getDocs(q);
  let maxOrder = 0;
  if (!snap.empty) {
    maxOrder = snap.docs[0].data().order;
  }

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

onSnapshot(
  query(tareasRef),
  (snapshot) => {
    const list = document.getElementById("list");
    list.innerHTML = "";

    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    // Separar y ordenar
    const tasks = docs
      .filter(d => !d.parent)
      .sort((a, b) => a.order - b.order);
    const subtasks = docs.filter(d => d.parent);

    // Actualizar lastTaskId para nuevas subtareas
    if (tasks.length) {
      lastTaskId = tasks[tasks.length - 1].id;
    }

    // Función para intercambiar orders entre dos hermanos
    const moveTask = async (id, parentId, direction) => {
      const siblings = docs
        .filter(d => (d.parent || null) === parentId)
        .sort((a, b) => a.order - b.order);
      const idx = siblings.findIndex(d => d.id === id);
      let targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= siblings.length) return;
      const current = siblings[idx];
      const target  = siblings[targetIdx];
      await updateDoc(doc(tareasRef, current.id), { order: target.order });
      await updateDoc(doc(tareasRef, target.id),  { order: current.order });
    };

    // Función para cambiar nivel (indentar/outdent)
    const changeParent = async (id, currentParent, direction) => {
      if (direction === "indent") {
        const siblings = docs
          .filter(d => (d.parent || null) === currentParent)
          .sort((a, b) => a.order - b.order);
        const idx = siblings.findIndex(d => d.id === id);
        if (idx > 0) {
          const newParent = siblings[idx - 1].id;
          await updateDoc(doc(tareasRef, id), { parent: newParent });
        }
      } else { // outdent
        if (!currentParent) return;
        const parentDoc = docs.find(d => d.id === currentParent);
        const newParent = parentDoc?.parent || null;
        await updateDoc(doc(tareasRef, id), { parent: newParent || deleteField() });
      }
    };

    // Render de tareas de primer nivel
    const containers = {};
    tasks.forEach(({ id, text, completed }) => {
      const li = document.createElement("li");
      li.className = "task-item";

      const contentDiv = document.createElement("div");
      contentDiv.className = "task-content";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.className = "form-check-input";
      cb.checked = completed;
      cb.addEventListener("change", () =>
        updateDoc(doc(tareasRef, id), { completed: cb.checked })
      );

      const span = document.createElement("span");
      span.textContent = text;
      if (completed) span.classList.add("completed");

      const indentBtn = document.createElement("button");
      indentBtn.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:1rem;color:#000";
      indentBtn.innerHTML = '<i class="bi bi-chevron-right"></i>';
      indentBtn.addEventListener("click", () => changeParent(id, null, "indent"));

      const outdentBtn = document.createElement("button");
      outdentBtn.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:1rem;color:#000";
      outdentBtn.innerHTML = '<i class="bi bi-chevron-left"></i>';
      outdentBtn.addEventListener("click", () => changeParent(id, null, "outdent"));

      const upBtn = document.createElement("button");
      upBtn.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:1rem;color:#000";
      upBtn.innerHTML = '<i class="bi bi-chevron-up"></i>';
      upBtn.addEventListener("click", () => moveTask(id, null, "up"));

      const downBtn = document.createElement("button");
      downBtn.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:1rem;color:#000";
      downBtn.innerHTML = '<i class="bi bi-chevron-down"></i>';
      downBtn.addEventListener("click", () => moveTask(id, null, "down"));

      const del = document.createElement("button");
      del.className = "delete-btn";
      del.innerHTML = '<i class="bi bi-x-lg"></i>';
      del.addEventListener("click", () =>
        deleteDoc(doc(tareasRef, id))
      );

      contentDiv.append(cb, span, indentBtn, outdentBtn, upBtn, downBtn, del);
      li.append(contentDiv);

      const subUl = document.createElement("ul");
      subUl.className = "subtask-list";
      li.append(subUl);
      list.append(li);
      containers[id] = subUl;
    });

    // Render de subtareas dentro de su padre
    tasks.forEach(task => {
      const parentUl = containers[task.id];
      const children = subtasks
        .filter(s => s.parent === task.id)
        .sort((a, b) => a.order - b.order);
      children.forEach(({ id, text, completed, parent }) => {
        const li = document.createElement("li");
        li.className = "task-item";

        const contentDiv = document.createElement("div");
        contentDiv.className = "task-content";

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "form-check-input";
        cb.checked = completed;
        cb.addEventListener("change", () =>
          updateDoc(doc(tareasRef, id), { completed: cb.checked })
        );

        const span = document.createElement("span");
        span.textContent = text;
        if (completed) span.classList.add("completed");

        const indentBtn = document.createElement("button");
        indentBtn.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:1rem;color:#000";
        indentBtn.innerHTML = '<i class="bi bi-chevron-right"></i>';
        indentBtn.addEventListener("click", () => changeParent(id, parent, "indent"));

        const outdentBtn = document.createElement("button");
        outdentBtn.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:1rem;color:#000";
        outdentBtn.innerHTML = '<i class="bi bi-chevron-left"></i>';
        outdentBtn.addEventListener("click", () => changeParent(id, parent, "outdent"));

        const upBtn = document.createElement("button");
        upBtn.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:1rem;color:#000";
        upBtn.innerHTML = '<i class="bi bi-chevron-up"></i>';
        upBtn.addEventListener("click", () => moveTask(id, parent, "up"));

        const downBtn = document.createElement("button");
        downBtn.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:1rem;color:#000";
        downBtn.innerHTML = '<i class="bi bi-chevron-down"></i>';
        downBtn.addEventListener("click", () => moveTask(id, parent, "down"));

        const del = document.createElement("button");
        del.className = "delete-btn";
        del.innerHTML = '<i class="bi bi-x-lg"></i>';
        del.addEventListener("click", () =>
          deleteDoc(doc(tareasRef, id))
        );

        contentDiv.append(cb, span, indentBtn, outdentBtn, upBtn, downBtn, del);
        li.append(contentDiv);
        parentUl.append(li);
      });
    });
  }
);
