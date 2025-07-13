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

  // Determinar parent
  let parentId = null;
  if (tipo === "subtask" && lastTaskId) {
    parentId = lastTaskId;
  }

  // Obtener todas las tareas y calcular el mayor 'order' para ese nivel
  const snapshotAll = await getDocs(tareasRef);
  const docs = snapshotAll.docs.map(d => ({ id: d.id, ...d.data() }));
  const siblings = docs.filter(d => (d.parent || null) === parentId);
  const maxOrder = siblings.reduce((max, d) => d.order > max ? d.order : max, 0);

  // Crear nuevo documento
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
  tareasRef,
  (snapshot) => {
    const list = document.getElementById("list");
    list.innerHTML = "";

    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    // Separar y ordenar
    const tasks    = docs.filter(d => !d.parent).sort((a, b) => a.order - b.order);
    const subtasks = docs.filter(d => d.parent);

    // Actualizar lastTaskId
    if (tasks.length) {
      lastTaskId = tasks[tasks.length - 1].id;
    }

    // Intercambiar orden entre hermanos
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

    // Cambiar nivel de indentación
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

      const btnFactory = icon => {
        const b = document.createElement("button");
        b.style.cssText = "border:none;background:transparent;cursor:pointer;font-size:1rem;color:#000";
        b.innerHTML = `<i class="bi bi-${icon}"></i>`;
        return b;
      };

      const indentBtn = btnFactory("chevron-right");
      indentBtn.addEventListener("click", () => changeParent(id, null, "indent"));

      const outdentBtn = btnFactory("chevron-left");
      outdentBtn.addEventListener("click", () => changeParent(id, null, "outdent"));

      const upBtn = btnFactory("chevron-up");
      upBtn.addEventListener("click", () => moveTask(id, null, "up"));

      const downBtn = btnFactory("chevron-down");
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

        const indentBtn = btnFactory("chevron-right");
        indentBtn.addEventListener("click", () => changeParent(id, parent, "indent"));

        const outdentBtn = btnFactory("chevron-left");
        outdentBtn.addEventListener("click", () => changeParent(id, parent, "outdent"));

        const upBtn = btnFactory("chevron-up");
        upBtn.addEventListener("click", () => moveTask(id, parent, "up"));

        const downBtn = btnFactory("chevron-down");
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
