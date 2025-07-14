import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  onSnapshot,
  getDocs,
  query,
  where                     // 👈 nuevos imports para filtrar por owner
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

// 👇 imports de autenticación
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,
  linkWithPopup
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

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);

// 👉 Esperamos a que el usuario esté autenticado (anónimo o Google) antes de iniciar la app
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    await signInAnonymously(auth);
    return; // onAuthStateChanged se disparará de nuevo
  }
  initTaskApp(); // Arrancamos toda la lógica original
});

// -------------------------
//  TODO EL CÓDIGO ORIGINAL
// -------------------------
function initTaskApp() {
  // Ocultamos el loader y mostramos la interfaz real
  document.getElementById("loading").style.display = "none";
  document.getElementById("app").style.display     = "block";

  const db  = getFirestore(app);
  const tareasRef = collection(db, "tareas");

  // UID actual (anónimo o Google)
  const uid = auth.currentUser.uid;

  // Vincular sesión a Google cuando se pulse el botón
  document.getElementById("google-btn").addEventListener("click", async () => {
    const provider = new GoogleAuthProvider();
    try {
      if (auth.currentUser.isAnonymous) {
        // Vinculamos sin perder datos
        await linkWithPopup(auth.currentUser, provider);
      } else {
        await signInWithPopup(auth, provider);
      }
      alert("¡Éxito! Tus tareas están vinculadas a tu cuenta Google.");
    } catch (err) {
      console.error(err);
      alert("Error al conectar con Google: " + err.message);
    }
  });

  // Guarda el ID de la última tarea de primer nivel para nuevas subtareas
  let lastTaskId = null;

  /** Parsea *word* → <strong>word</strong> */
  function parseMarkup(text) {
    return text.replace(/\*(.+?)\*/g, '<strong>$1</strong>');
  }

  // Añadir tarea individual
  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = e.target.text.value.trim();
    const tipo  = document.getElementById("type-selector").value;
    if (!texto) return;

    let parentId = null;
    if (tipo === "subtask" && lastTaskId) {
      parentId = lastTaskId;
    }

    const snapshotAll = await getDocs(query(tareasRef, where("owner", "==", uid)));
    const docs = snapshotAll.docs.map(d => ({ id: d.id, ...d.data() }));
    const siblings = docs.filter(d => (d.parent || null) === parentId);
    const maxOrder = siblings.reduce((max, d) => d.order > max ? d.order : max, 0);

    const nuevo = {
      text: texto,
      completed: false,
      ts: Date.now(),
      order: maxOrder + 1,
      owner: uid                          // 👈 guardamos el propietario
    };
    if (parentId) nuevo.parent = parentId;

    await addDoc(tareasRef, nuevo);
    e.target.text.value = "";
  });

  // Configurar Bulk UI
  const bulkBtn       = document.getElementById("bulk-btn");
  const bulkContainer = document.getElementById("bulk-container");
  const bulkCancel    = document.getElementById("bulk-cancel-btn");
  const bulkAddBtn    = document.getElementById("bulk-add-btn");
  const bulkText      = document.getElementById("bulk-text");

  bulkBtn.addEventListener("click", () => {
    bulkContainer.style.display = "block";
  });
  bulkCancel.addEventListener("click", () => {
    bulkContainer.style.display = "none";
    bulkText.value = "";
  });

  bulkAddBtn.addEventListener("click", async () => {
    const lines = bulkText.value.split("\n").map(l => l.trim()).filter(l => l);
    let currentTaskId = null;

    for (let raw of lines) {
      if (raw.startsWith("--")) {
        // Subtarea
        const text = raw.replace(/^--\s*/, "");
        if (!currentTaskId) continue;
        const snapshotAll = await getDocs(query(tareasRef, where("owner", "==", uid)));
        const siblings = snapshotAll.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => d.parent === currentTaskId);
        const maxOrder = siblings.reduce((m, d) => d.order > m ? d.order : m, 0);

        await addDoc(tareasRef, {
          text,
          completed: false,
          ts: Date.now(),
          order: maxOrder + 1,
          parent: currentTaskId,
          owner: uid                  // 👈 propietario
        });
      } else if (raw.startsWith("-")) {
        // Tarea
        const text = raw.replace(/^-+\s*/, "");
        const snapshotAll = await getDocs(query(tareasRef, where("owner", "==", uid)));
        const docs = snapshotAll.docs.map(d => ({ id: d.id, ...d.data() }));
        const topSiblings = docs.filter(d => !d.parent);
        const maxOrder = topSiblings.reduce((m, d) => d.order > m ? d.order : m, 0);

        const ref = await addDoc(tareasRef, {
          text,
          completed: false,
          ts: Date.now(),
          order: maxOrder + 1,
          owner: uid                // 👈 propietario
        });
        currentTaskId = ref.id;
      }
    }

    // Limpiar UI
    bulkContainer.style.display = "none";
    bulkText.value = "";
  });

  // Renderizado en tiempo real (solo nuestras tareas)
  onSnapshot(query(tareasRef, where("owner", "==", uid)), (snapshot) => {
    const list = document.getElementById("list");
    list.innerHTML = "";

    const docs    = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const tasks   = docs.filter(d => !d.parent).sort((a, b) => a.order - b.order);
    const subtasks= docs.filter(d => d.parent);

    if (tasks.length) lastTaskId = tasks[tasks.length - 1].id;

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

      // texto con markup
      const span = document.createElement("span");
      span.classList.add("task-text");
      if (completed) span.classList.add("completed");
      span.innerHTML = parseMarkup(text);

      // controles
      const del     = btnFactory("x-lg", () => deleteDoc(doc(tareasRef, id)));
      const upBtn   = btnFactory("chevron-up",   () => moveTask(id, null, "up"));
      const downBtn = btnFactory("chevron-down", () => moveTask(id, null, "down"));

      contentDiv.append(cb, span, upBtn, downBtn, del);
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
        span.classList.add("task-text");
        if (completed) span.classList.add("completed");
        span.innerHTML = parseMarkup(text);

        const del     = btnFactory("x-lg",        () => deleteDoc(doc(tareasRef, id)));
        const upBtn   = btnFactory("chevron-up",   () => moveTask(id, parent, "up"));
        const downBtn = btnFactory("chevron-down", () => moveTask(id, parent, "down"));

        contentDiv.append(cb, span, upBtn, downBtn, del);
        li.append(contentDiv);
        parentUl.append(li);
      });
    });
  });
}