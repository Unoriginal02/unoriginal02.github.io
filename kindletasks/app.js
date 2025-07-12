import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, deleteDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// Config Firebase
const firebaseConfig = {
  apiKey: "AIzaSyAlBA_fpzJvWobC3oqdZnTdzSvxDJHDwZI",
  authDomain: "unoriginal-tasks.firebaseapp.com",
  projectId: "unoriginal-tasks",
  storageBucket: "unoriginal-tasks.firebasestorage.app",
  messagingSenderId: "699262931203",
  appId: "1:699262931203:web:aac24b8fd3c5eba0ea9936"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const tareasRef = collection(db, "tareas");

const form = document.getElementById("form");
const input = document.getElementById("textInput");
const toggleFormBtn = document.getElementById("toggleForm");
const indentBtn = document.getElementById("indentBtn");

let indentLevel = 0;
let tasks = [];

toggleFormBtn.addEventListener("click", () => {
  form.classList.toggle("hidden");
});

indentBtn.addEventListener("click", () => {
  indentLevel = (indentLevel + 1) % 3;
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (input.value.trim()) {
    await addDoc(tareasRef, {
      text: input.value.trim(),
      ts: Date.now(),
      indent: indentLevel
    });
    input.value = "";
    indentLevel = 0;
    form.classList.add("hidden");
  }
});

onSnapshot(query(tareasRef, orderBy("ts", "asc")), (snapshot) => {
  tasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  renderTasks();
});

function renderTasks() {
  const list = document.getElementById("list");
  list.innerHTML = "";
  tasks.forEach(task => {
    const li = document.createElement("li");
    li.className = `task indent-${task.indent || 0}`;
    li.setAttribute("draggable", true);
    li.dataset.id = task.id;

    const handle = document.createElement("span");
    handle.className = "handle";
    handle.textContent = "≡";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";

    const text = document.createElement("span");
    text.className = "text";
    text.textContent = task.text;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "delete";
    deleteBtn.textContent = "✕";
    deleteBtn.onclick = () => deleteDoc(doc(db, "tareas", task.id));

    li.appendChild(handle);
    li.appendChild(checkbox);
    li.appendChild(text);
    li.appendChild(deleteBtn);
    list.appendChild(li);
  });

  addDragAndDrop();
}

function addDragAndDrop() {
  const list = document.getElementById("list");
  let dragSrcEl = null;

  list.querySelectorAll(".task").forEach(el => {
    el.addEventListener("dragstart", (e) => {
      dragSrcEl = el;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/html", el.outerHTML);
      setTimeout(() => el.style.display = "none", 0);
    });

    el.addEventListener("dragover", (e) => e.preventDefault());

    el.addEventListener("drop", async (e) => {
      e.stopPropagation();
      if (dragSrcEl !== el) {
        const draggedId = dragSrcEl.dataset.id;
        const targetId = el.dataset.id;
        const draggedIndex = tasks.findIndex(t => t.id === draggedId);
        const targetIndex = tasks.findIndex(t => t.id === targetId);
        const [movedTask] = tasks.splice(draggedIndex, 1);
        tasks.splice(targetIndex, 0, movedTask);

        for (let i = 0; i < tasks.length; i++) {
          await updateDoc(doc(db, "tareas", tasks[i].id), { ts: i });
        }
      }
    });

    el.addEventListener("dragend", () => {
      dragSrcEl.style.display = "flex";
    });
  });
}
