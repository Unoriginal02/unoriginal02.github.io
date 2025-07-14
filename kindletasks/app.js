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
  signInAnonymously,
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

/* --- Inicialización --- */
const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

/* --- Login invisible --- */
signInAnonymously(auth).catch(err => console.error("Anon-auth error:", err));

onAuthStateChanged(auth, user => {
  if (user) {
    console.log("Auth OK → UID:", user.uid);
    iniciarApp();          // arrancamos la lógica sólo si hay user
  } else {
    console.warn("Sin usuario.");
  }
});

/* ---------------- LÓGICA PRINCIPAL ---------------- */
function iniciarApp() {

  const tareasRef = collection(db, "tareas");

  // Guarda el ID de la última tarea de 1er nivel para nuevas subtareas
  let lastTaskId = null;

  /** Parsea *word* → <strong>word</strong> */
  const parseMarkup = (text) => text.replace(/\*(.+?)\*/g, '<strong>$1</strong>');

  /* ---------- Añadir tarea individual ---------- */
  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = e.target.text.value.trim();
    const tipo  = document.getElementById("type-selector").value;
    if (!texto) return;

    let parentId = null;
    if (tipo === "subtask" && lastTaskId) parentId = lastTaskId;

    const snapshotAll = await getDocs(tareasRef);
    const docs   = snapshotAll.docs.map(d => ({ id: d.id, ...d.data() }));
    const maxOrd = docs
      .filter(d => (d.parent || null) === parentId)
      .reduce((m, d) => d.order > m ? d.order : m, 0);

    await addDoc(tareasRef, {
      text: texto,
      completed: false,
      ts: Date.now(),
      order: maxOrd + 1,
      ...(parentId ? { parent: parentId } : {})
    });

    e.target.text.value = "";
  });

  /* ---------- Bulk UI ---------- */
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
    const lines = bulkText.value.split("\n").map(l => l.trim()).filter(Boolean);
    let currentTaskId = null;

    for (let raw of lines) {
      if (raw.startsWith("--")) {
        /* Subtarea */
        if (!currentTaskId) continue;
        const text     = raw.replace(/^--\s*/, "");
        const siblings = (await getDocs(tareasRef)).docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => d.parent === currentTaskId);
        const maxOrd = siblings.reduce((m, d) => d.order > m ? d.order : m, 0);

        await addDoc(tareasRef, {
          text, completed:false, ts:Date.now(),
          order:maxOrd+1, parent:currentTaskId
        });

      } else if (raw.startsWith("-")) {
        /* Tarea de primer nivel */
        const text = raw.replace(/^-+\s*/, "");
        const topSiblings = (await getDocs(tareasRef)).docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => !d.parent);
        const maxOrd = topSiblings.reduce((m, d) => d.order > m ? d.order : m, 0);

        const ref = await addDoc(tareasRef, {
          text, completed:false, ts:Date.now(), order:maxOrd+1
        });
        currentTaskId = ref.id;
      }
    }

    bulkContainer.style.display = "none";
    bulkText.value = "";
  });

  /* ---------- Render en tiempo real ---------- */
  onSnapshot(tareasRef, (snapshot) => {
    const list = document.getElementById("list");
    list.innerHTML = "";

    const docs     = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const tasks    = docs.filter(d => !d.parent).sort((a,b)=>a.order-b.order);
    const subtasks = docs.filter(d =>  d.parent);

    if (tasks.length) lastTaskId = tasks[tasks.length-1].id;

    const moveTask = async (id, parentId, dir) => {
      const siblings = docs
        .filter(d => (d.parent||null) === parentId)
        .sort((a,b)=>a.order-b.order);
      const i = siblings.findIndex(d => d.id === id);
      const j = dir === "up" ? i-1 : i+1;
      if (j<0 || j>=siblings.length) return;
      await updateDoc(doc(tareasRef, siblings[i].id), { order: siblings[j].order });
      await updateDoc(doc(tareasRef, siblings[j].id), { order: siblings[i].order });
    };

    const mkBtn = (icon, fn) => {
      const b = document.createElement("button");
      b.type="button"; b.className="icon-btn";
      b.innerHTML=`<i class="bi bi-${icon}"></i>`;
      b.addEventListener("click", fn);
      return b;
    };

    const mkCheckbox = (id, done) => {
      const btn = document.createElement("button");
      btn.type="button"; btn.className="checkbox-btn"+(done?" checked":"");
      btn.innerHTML='<i class="bi bi-check-lg"></i>';
      btn.addEventListener("click", async () => {
        const newState = !btn.classList.contains("checked");
        btn.classList.toggle("checked", newState);
        await updateDoc(doc(tareasRef, id), { completed: newState });
      });
      return btn;
    };

    const containers = {};   /* para meter subtareas */

    /* --- Tareas de 1er nivel --- */
    tasks.forEach(({id,text,completed})=>{
      const li  = document.createElement("li"); li.className="task-item";
      const div = document.createElement("div"); div.className="task-content";

      const cb   = mkCheckbox(id, completed);
      const span = document.createElement("span");
      span.className="task-text"+(completed?" completed":"");
      span.innerHTML=parseMarkup(text);

      const del   = mkBtn("x-lg",        ()=>deleteDoc(doc(tareasRef,id)));
      const up    = mkBtn("chevron-up",  ()=>moveTask(id,null,"up"));
      const down  = mkBtn("chevron-down",()=>moveTask(id,null,"down"));

      div.append(cb,span,up,down,del);
      li.append(div);

      const subUl = document.createElement("ul"); subUl.className="subtask-list";
      li.append(subUl);

      list.append(li);
      containers[id]=subUl;
    });

    /* --- Subtareas --- */
    tasks.forEach(task=>{
      const subUl = containers[task.id];
      subtasks
        .filter(s=>s.parent===task.id)
        .sort((a,b)=>a.order-b.order)
        .forEach(({id,text,completed,parent})=>{
          const li  = document.createElement("li"); li.className="subtask-item";
          const div = document.createElement("div"); div.className="task-content";
          const cb   = mkCheckbox(id, completed);
          const span = document.createElement("span");
          span.className="task-text"+(completed?" completed":"");
          span.innerHTML=parseMarkup(text);

          const del   = mkBtn("x-lg",        ()=>deleteDoc(doc(tareasRef,id)));
          const up    = mkBtn("chevron-up",  ()=>moveTask(id,parent,"up"));
          const down  = mkBtn("chevron-down",()=>moveTask(id,parent,"down"));

          div.append(cb,span,up,down,del);
          li.append(div);
          subUl.append(li);
        });
    });
  });
}