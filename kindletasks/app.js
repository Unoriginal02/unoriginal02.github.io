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
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";

/* ⚠️ Sustituye con tu propia configuración */
const firebaseConfig = {
  apiKey: "AIzaSyAlBA_fpzJvWobC3oqdZnTdzSvxDJHDwZI",
  authDomain: "unoriginal-tasks.firebaseapp.com",
  projectId: "unoriginal-tasks",
  storageBucket: "unoriginal-tasks.appspot.com",
  messagingSenderId: "699262931203",
  appId: "1:699262931203:web:aac24b8fd3c5eba0ea9936"
};

// --- Inicialización ---
const app   = initializeApp(firebaseConfig);
const db    = getFirestore(app);
const auth  = getAuth(app);
const provider = new GoogleAuthProvider();

// --- Referencias dinámicas ---
let tareasRef      = null;   // Se define después de login
let unsubscribeRT  = null;   // Para detener onSnapshot al cambiar de usuario
let lastTaskId     = null;   // Última tarea de primer nivel

// --- Controles de UI ---
const loginBtn   = document.getElementById("login-btn");
const logoutBtn  = document.getElementById("logout-btn");
const userInfo   = document.getElementById("user-info");
const userPhoto  = document.getElementById("user-photo");
const userNameEl = document.getElementById("user-name");

// --- Helper: parsea *word* -> <strong>word</strong> ---
const parseMarkup = text => text.replace(/\*(.+?)\*/g, '<strong>$1</strong>');

// ---------- Autenticación ----------
loginBtn.addEventListener("click", () => signInWithPopup(auth, provider));
logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, user => {
  if (user) {
    // --- UI de sesión ---
    loginBtn.style.display = "none";
    logoutBtn.style.display = "inline-block";
    userInfo.style.display = "flex";
    userNameEl.textContent = user.displayName || user.email;
    userPhoto.src = user.photoURL || "https://www.gravatar.com/avatar/?d=mp";

    // --- Colección de tareas del usuario ---
    tareasRef = collection(db, `users/${user.uid}/tareas`);

    // Inicia escucha en tiempo real
    subscribeToTasks();
  } else {
    // Sin sesión: oculta UI y pide login
    loginBtn.style.display  = "inline-block";
    logoutBtn.style.display = "none";
    userInfo.style.display  = "none";

    // Detén listener anterior (si existía)
    if (unsubscribeRT) unsubscribeRT();
    tareasRef = null;
    clearList();

    // Lanzamos automáticamente el popup de login la primera vez
    signInWithPopup(auth, provider).catch(() => {
      /* usuario cerró el popup: se queda la página en modo login */
    });
  }
});

// ---------- Lógica de tareas ----------
document.getElementById("form").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!tareasRef) return alert("Debes iniciar sesión.");
  const texto = e.target.text.value.trim();
  const tipo  = document.getElementById("type-selector").value;
  if (!texto) return;

  let parentId = null;
  if (tipo === "subtask" && lastTaskId) parentId = lastTaskId;

  const snapshotAll = await getDocs(tareasRef);
  const docs = snapshotAll.docs.map(d => ({ id: d.id, ...d.data() }));
  const siblings = docs.filter(d => (d.parent || null) === parentId);
  const maxOrder = siblings.reduce((m, d) => d.order > m ? d.order : m, 0);

  const nuevo = {
    text: texto,
    completed: false,
    ts: Date.now(),
    order: maxOrder + 1,
    ...(parentId ? { parent: parentId } : {})
  };

  await addDoc(tareasRef, nuevo);
  e.target.text.value = "";
});

// === Bulk UI ===
const bulkBtn       = document.getElementById("bulk-btn");
const bulkContainer = document.getElementById("bulk-container");
const bulkCancel    = document.getElementById("bulk-cancel-btn");
const bulkAddBtn    = document.getElementById("bulk-add-btn");
const bulkText      = document.getElementById("bulk-text");

bulkBtn.addEventListener("click", () => bulkContainer.style.display = "block");
bulkCancel.addEventListener("click", () => {
  bulkContainer.style.display = "none";
  bulkText.value = "";
});

bulkAddBtn.addEventListener("click", async () => {
  if (!tareasRef) return alert("Debes iniciar sesión.");
  const lines = bulkText.value.split("\n").map(l => l.trim()).filter(Boolean);
  let currentTaskId = null;

  for (let raw of lines) {
    if (raw.startsWith("--")) {
      if (!currentTaskId) continue;
      const text = raw.replace(/^--\s*/, "");
      const snapshotAll = await getDocs(tareasRef);
      const siblings = snapshotAll.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(d => d.parent === currentTaskId);
      const maxOrder = siblings.reduce((m, d) => d.order > m ? d.order : m, 0);

      await addDoc(tareasRef, {
        text,
        completed:false,
        ts:Date.now(),
        order:maxOrder+1,
        parent:currentTaskId
      });
    } else if (raw.startsWith("-")) {
      const text = raw.replace(/^-+\s*/, "");
      const snapshotAll = await getDocs(tareasRef);
      const docs = snapshotAll.docs.map(d => ({ id: d.id, ...d.data() }));
      const topSiblings = docs.filter(d => !d.parent);
      const maxOrder = topSiblings.reduce((m,d) => d.order>m?d.order:m,0);

      const ref = await addDoc(tareasRef,{
        text,
        completed:false,
        ts:Date.now(),
        order:maxOrder+1
      });
      currentTaskId = ref.id;
    }
  }

  bulkContainer.style.display = "none";
  bulkText.value = "";
});

// === Tiempo real ===
function subscribeToTasks() {
  if (unsubscribeRT) unsubscribeRT(); // Limpia anterior
  unsubscribeRT = onSnapshot(tareasRef, (snapshot) => {
    const docs    = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTasks(docs);
  });
}

function clearList() {
  document.getElementById("list").innerHTML = "";
  lastTaskId = null;
}

function renderTasks(docs) {
  const list = document.getElementById("list");
  list.innerHTML = "";

  const tasks    = docs.filter(d => !d.parent).sort((a,b)=>a.order-b.order);
  const subtasks = docs.filter(d => d.parent);

  if (tasks.length) lastTaskId = tasks[tasks.length-1].id;

  const moveTask = async (id,parentId,direction) => {
    const siblings = docs
      .filter(d => (d.parent||null) === parentId)
      .sort((a,b)=>a.order-b.order);
    const idx = siblings.findIndex(d => d.id===id);
    const targetIdx = direction==="up" ? idx-1 : idx+1;
    if(targetIdx<0||targetIdx>=siblings.length) return;
    const current = siblings[idx], target = siblings[targetIdx];
    await updateDoc(doc(tareasRef,current.id),{order:target.order});
    await updateDoc(doc(tareasRef,target.id), {order:current.order});
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
  tasks.forEach(({id,text,completed})=>{
    const li = document.createElement("li"); li.className="task-item";
    const contentDiv=document.createElement("div");contentDiv.className="task-content";

    // checkbox
    const cb = renderCheckbox(id,completed);

    // texto
    const span=document.createElement("span");
    span.classList.add("task-text");
    if(completed) span.classList.add("completed");
    span.innerHTML = parseMarkup(text);

    // controles
    const del   = btnFactory("x-lg",()=>deleteDoc(doc(tareasRef,id)));
    const upBtn = btnFactory("chevron-up",()=>moveTask(id,null,"up"));
    const dnBtn = btnFactory("chevron-down",()=>moveTask(id,null,"down"));

    contentDiv.append(cb,span,upBtn,dnBtn,del);
    li.append(contentDiv);

    const subUl=document.createElement("ul");
    subUl.className="subtask-list";
    li.append(subUl);
    list.append(li);
    containers[id]=subUl;
  });

  tasks.forEach(task=>{
    const parentUl = containers[task.id];
    const children = subtasks.filter(s=>s.parent===task.id).sort((a,b)=>a.order-b.order);
    children.forEach(({id,text,completed,parent})=>{
      const li=document.createElement("li"); li.className="subtask-item";
      const contentDiv=document.createElement("div");contentDiv.className="task-content";

      const cb = renderCheckbox(id,completed);
      const span=document.createElement("span");
      span.classList.add("task-text");
      if(completed) span.classList.add("completed");
      span.innerHTML=parseMarkup(text);

      const del   = btnFactory("x-lg",()=>deleteDoc(doc(tareasRef,id)));
      const upBtn = btnFactory("chevron-up",()=>moveTask(id,parent,"up"));
      const dnBtn = btnFactory("chevron-down",()=>moveTask(id,parent,"down"));

      contentDiv.append(cb,span,upBtn,dnBtn,del);
      li.append(contentDiv);
      parentUl.append(li);
    });
  });
}