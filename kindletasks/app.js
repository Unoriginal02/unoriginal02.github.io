import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, deleteDoc,
  doc, updateDoc, onSnapshot, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

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

let lastTaskId = null;

/* -------- Añadir nueva tarea -------- */
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = e.target.text;
  const selector = document.getElementById("typeSelector");
  const type = selector.value;

  if (input.value.trim()) {
    let parentId = null;

    if (type === "subtask" && lastTaskId) {
      parentId = lastTaskId;
    }

    const docRef = await addDoc(tareasRef, {
      text: input.value.trim(),
      completed: false,
      ts: Date.now(),
      parent: parentId
    });

    // Si es una tarea principal, recuerda su ID
    if (type === "task") {
      lastTaskId = docRef.id;
    }

    input.value = "";
  }
});

/* -------- Mostrar tareas -------- */
onSnapshot(query(tareasRef, orderBy("ts", "asc")), (snapshot) => {
  const list = document.getElementById("list");
  list.innerHTML = "";

  const items = [];

  // Construir mapa para relaciones padre-hijo
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    items.push({ id: docSnap.id, ...data });
  });

  const renderTasks = (parentId = null, level = 0) => {
    items
      .filter(item => item.parent === parentId)
      .forEach(item => {
        const li = document.createElement("li");
        li.className = "task-item";
        if (level > 0) li.classList.add("subtask");

        const checkbox = document.createElement("input");
        checkbox.type  = "checkbox";
        checkbox.className = "form-check-input";
        checkbox.checked   = item.completed;

        const span = document.createElement("span");
        span.textContent = item.text;
        if (item.completed) span.classList.add("completed");

        const delBtn = document.createElement("button");
        delBtn.className = "delete-btn";
        delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';

        checkbox.addEventListener("change", async () => {
          await updateDoc(doc(tareasRef, item.id), { completed: checkbox.checked });
        });

        delBtn.addEventListener("click", async () => {
          await deleteDoc(doc(tareasRef, item.id));
        });

        li.appendChild(checkbox);
        li.appendChild(span);
        li.appendChild(delBtn);
        list.appendChild(li);

        // Renderizar subtareas recursivamente
        renderTasks(item.id, level + 1);
      });
  };

  renderTasks();
});
