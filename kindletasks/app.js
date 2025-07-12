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

async function getLastTaskId() {
  const q = query(
    tareasRef,
    where("type", "==", "task"),
    orderBy("ts", "desc"),
    limit(1)
  );
  const snap = await getDocs(q);
  if (!snap.empty) {
    return snap.docs[0].id;
  }
  return null;
}

/* -------- Añadir nueva tarea o subtarea -------- */
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input     = e.target.text;
  const select    = document.getElementById("taskType");
  const kind      = select.value; // "task" o "subtask"
  const textValue = input.value.trim();

  if (!textValue) return;

  let payload = {
    text: textValue,
    completed: false,
    ts: Date.now(),
    type: kind
  };

  if (kind === "subtask") {
    const parentId = await getLastTaskId();
    if (parentId) {
      payload.parent = parentId;
    }
  }

  await addDoc(tareasRef, payload);
  input.value = "";
});

/* -------- Actualizar lista en tiempo real -------- */
onSnapshot(query(tareasRef, orderBy("ts", "desc")), (snapshot) => {
  const list = document.getElementById("list");
  list.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const li   = document.createElement("li");
    li.className = "task-item";
    if (data.type === "subtask") {
      li.classList.add("subtask");
    }

    /* Checkbox */
    const checkbox = document.createElement("input");
    checkbox.type      = "checkbox";
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