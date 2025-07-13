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

// In‐memory caches of the last snapshot
let tasksData = [];
let subtasksData = [];
let lastTaskId = null;

// --- DRAG & DROP STATE ---
let dragSrc = { id: null, parent: null };

// --- FORM HANDLER ---
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const texto = e.target.text.value.trim();
  const tipo  = document.getElementById("type-selector").value;
  if (!texto) return;

  // Build new document payload, including an initial `order`
  const nuevo = {
    text: texto,
    completed: false,
    ts: Date.now()
  };
  if (tipo === "task") {
    // New top‐level task goes at the end
    nuevo.order = tasksData.length;
  } else if (tipo === "subtask" && lastTaskId) {
    nuevo.parent = lastTaskId;
    // New subtask at end of its group
    const siblings = subtasksData.filter(d => d.parent === lastTaskId);
    nuevo.order = siblings.length;
  }

  await addDoc(tareasRef, nuevo);
  e.target.text.value = "";
});

// --- FIRESTORE SNAPSHOT + RENDERING ---
const list = document.getElementById("list");
onSnapshot(
  query(tareasRef, orderBy("ts", "asc")),
  (snapshot) => {
    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    // Sort by `order` (if set) or fallback to `ts`
    docs.sort((a, b) => (a.order ?? a.ts) - (b.order ?? b.ts));

    tasksData    = docs.filter(d => !d.parent);
    subtasksData = docs.filter(d => d.parent);

    if (tasksData.length) {
      lastTaskId = tasksData[tasksData.length - 1].id;
    }

    // Clear & rebuild
    list.innerHTML = "";

    // Render tasks
    tasksData.forEach(({ id, text, completed }) => {
      const li = document.createElement("li");
      li.className = "task-item";
      li.draggable = true;
      li.dataset.id     = id;
      li.dataset.parent = ""; // top‐level

      // checkbox, label, delete
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

      // events
      cb.addEventListener("change", () =>
        updateDoc(doc(tareasRef, id), { completed: cb.checked })
      );
      del.addEventListener("click", () =>
        deleteDoc(doc(tareasRef, id))
      );

      contentDiv.append(cb, span, del);
      li.append(contentDiv);

      // drag‐and‐drop listeners on each item
      li.addEventListener("dragstart", handleDragStart);
      li.addEventListener("dragover", handleDragOverItem);
      li.addEventListener("drop", handleDropItem);

      // Subtask container
      const subUl = document.createElement("ul");
      subUl.className = "subtask-list";
      subUl.dataset.parent = id;
      // allow dropping subtasks here
      subUl.addEventListener("dragover", handleDragOverList);
      subUl.addEventListener("drop", handleDropList);
      li.append(subUl);

      list.append(li);
    });

    // Render subtasks into their group's <ul>
    subtasksData.forEach(({ id, text, completed, parent }) => {
      const parentUl = list.querySelector(`ul.subtask-list[data-parent="${parent}"]`);
      if (!parentUl) return;

      const li = document.createElement("li");
      li.className = "task-item";
      li.draggable = true;
      li.dataset.id     = id;
      li.dataset.parent = parent;

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

      // drag‐and‐drop
      li.addEventListener("dragstart", handleDragStart);
      li.addEventListener("dragover", handleDragOverItem);
      li.addEventListener("drop", handleDropItem);

      parentUl.append(li);
    });
  }
);

// allow dropping tasks at end of top‐level
list.addEventListener("dragover", handleDragOverList);
list.addEventListener("drop", handleDropList);

// ―――――――――――――――――――
// Drag & drop handlers
// ―――――――――――――――――――

function handleDragStart(e) {
  const li = e.target.closest("li.task-item");
  dragSrc.id     = li.dataset.id;
  dragSrc.parent = li.dataset.parent || null;
  e.dataTransfer.effectAllowed = "move";
}

function handleDragOverList(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function handleDragOverItem(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function handleDropList(e) {
  e.preventDefault();
  const ul = e.currentTarget; // could be #list or a .subtask-list
  const isTop = ul.id === "list";
  // tasks only in top
  if (dragSrc.parent !== null && isTop) return;
  // subtasks only in sub‐lists
  if (dragSrc.parent === null && !isTop) return;

  const newParent = isTop ? null : ul.dataset.parent;
  reorderElement(dragSrc.id, ul, newParent, /*end*/ null);
}

function handleDropItem(e) {
  e.preventDefault();
  const targetLi = e.target.closest("li.task-item");
  const ul       = targetLi.parentNode;
  const isTop    = ul.id === "list";

  if (dragSrc.parent !== null && isTop) return;
  if (dragSrc.parent === null && !isTop) return;

  const newParent = isTop ? null : ul.dataset.parent;

  // figure out whether to drop before or after targetLi
  const rect   = targetLi.getBoundingClientRect();
  const offset = e.clientY - rect.top;
  const siblings = Array.from(ul.children);
  const idxTarget = siblings.indexOf(targetLi);
  const dropIndex = offset > rect.height/2 ? idxTarget + 1 : idxTarget;

  reorderElement(dragSrc.id, ul, newParent, dropIndex);
}

async function reorderElement(dragId, ul, newParent, index = null) {
  // Build the list of items to reorder
  let listItems, isTop = newParent === null;
  if (isTop) {
    listItems = [...tasksData];
  } else {
    listItems = subtasksData.filter(d => d.parent === newParent);
  }

  // Remove existing, if present
  const oldIdx = listItems.findIndex(d => d.id === dragId);
  if (oldIdx !== -1) listItems.splice(oldIdx, 1);

  // Default to append at end
  if (index === null || index > listItems.length) index = listItems.length;

  // Grab the dragged item details
  const draggedDoc = tasksData.find(d => d.id === dragId)
                   || subtasksData.find(d => d.id === dragId);

  // If moving subtask to a new parent, update its `parent`
  if (!isTop && draggedDoc.parent !== newParent) {
    await updateDoc(doc(tareasRef, dragId), { parent: newParent });
    draggedDoc.parent = newParent;
  }

  // Insert it in the new slot
  listItems.splice(index, 0, draggedDoc);

  // Persist the new ordering (0,1,2,…) into each item's `order` field
  for (let i = 0; i < listItems.length; i++) {
    const item = listItems[i];
    await updateDoc(doc(tareasRef, item.id), { order: i });
  }
}
