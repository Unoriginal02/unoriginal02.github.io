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
  let lastTaskId = null;
  let activeEditorLi = null;   // ➕ Editor en línea activo (sólo 1 a la vez)

  const parseMarkup = (text) => marked.parseInline(text);

  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const texto = e.target.text.value.trim();
    const tipo = document.getElementById("type-selector").value;
    if (!texto) return;

    let parentId = null;
    if (tipo === "subtask" && lastTaskId) parentId = lastTaskId;

    const snapshotAll = await getDocs(tareasRef);
    const docs = snapshotAll.docs.map(d => ({ id: d.id, ...d.data() }));
    const maxOrd = docs
      .filter(d => (d.parent || null) === parentId)
      .reduce((m, d) => d.order > m ? d.order : m, 0);

    const data = {
      text: texto,
      completed: false,
      ts: Date.now(),
      order: maxOrd + 1,
      ...(parentId ? { parent: parentId } : {})
    };

    if (tipo === "comment") {
      delete data.completed;
      data.note = true;
    }

    await addDoc(tareasRef, data);
    e.target.text.value = "";
  });

  const bulkBtn = document.getElementById("bulk-btn");
  const bulkContainer = document.getElementById("bulk-container");
  const bulkCancel = document.getElementById("bulk-cancel-btn");
  const bulkAddBtn = document.getElementById("bulk-add-btn");
  const bulkText = document.getElementById("bulk-text");

  bulkBtn.addEventListener("click", () => bulkContainer.style.display = "block");
  bulkCancel.addEventListener("click", () => {
    bulkContainer.style.display = "none";
    bulkText.value = "";
  });

  bulkAddBtn.addEventListener("click", async () => {
    const lines = bulkText.value.split("\n");
    let currentTaskId = null;

    for (let raw of lines) {
      const line = raw.trim();
      if (!line) continue;

      if (line.startsWith("--")) {
        if (!currentTaskId) continue;
        const text = line.replace(/^--\s*/, "");
        const siblings = (await getDocs(tareasRef)).docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => d.parent === currentTaskId);
        const maxOrd = siblings.reduce((m, d) => d.order > m ? d.order : m, 0);
        await addDoc(tareasRef, {
          text, completed: false, ts: Date.now(),
          order: maxOrd + 1, parent: currentTaskId
        });
      } else if (line.startsWith("-")) {
        const text = line.replace(/^-+\s*/, "");
        const topSiblings = (await getDocs(tareasRef)).docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => !d.parent);
        const maxOrd = topSiblings.reduce((m, d) => d.order > m ? d.order : m, 0);
        const ref = await addDoc(tareasRef, {
          text, completed: false, ts: Date.now(), order: maxOrd + 1
        });
        currentTaskId = ref.id;
      } else {
        const text = line;
        const topSiblings = (await getDocs(tareasRef)).docs
          .map(d => ({ id: d.id, ...d.data() }))
          .filter(d => !d.parent);
        const maxOrd = topSiblings.reduce((m, d) => d.order > m ? d.order : m, 0);
        await addDoc(tareasRef, {
          text, ts: Date.now(), order: maxOrd + 1, note: true
        });
        currentTaskId = null;
      }
    }

    bulkContainer.style.display = "none";
    bulkText.value = "";
  });

  onSnapshot(tareasRef, (snapshot) => {
    const list = document.getElementById("list");
    list.innerHTML = "";

    const docs = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    const tasks = docs.filter(d => !d.parent).sort((a, b) => a.order - b.order);
    const subtasks = docs.filter(d => d.parent);

    if (tasks.length) lastTaskId = tasks[tasks.length - 1].id;

    /* -------- Mover tarea arriba/abajo -------- */
    const moveTask = async (id, parentId, dir) => {
      const siblings = docs
        .filter(d => (d.parent || null) === parentId)
        .sort((a, b) => a.order - b.order);
      const i = siblings.findIndex(d => d.id === id);
      const j = dir === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= siblings.length) return;
      await updateDoc(doc(tareasRef, siblings[i].id), { order: siblings[j].order });
      await updateDoc(doc(tareasRef, siblings[j].id), { order: siblings[i].order });
    };

    /* -------- Crear botón genérico -------- */
    const mkBtn = (icon, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "icon-btn";
      b.innerHTML = `<i class="bi bi-${icon}"></i>`;
      b.addEventListener("click", fn);
      return b;
    };

    /* -------- Crear checkbox personalizado -------- */
    const mkCheckbox = (id, done) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "checkbox-btn" + (done ? " checked" : "");
      btn.innerHTML = '<i class="bi bi-check-lg"></i>';
      btn.addEventListener("click", async () => {
        const newState = !btn.classList.contains("checked");
        btn.classList.toggle("checked", newState);
        await updateDoc(doc(tareasRef, id), { completed: newState });
      });
      return btn;
    };

    /* -------- Editor inline (➕) -------- */
    const openInlineEditor = (clickedLi, clickedDoc) => {
      // Solo uno activo
      if (activeEditorLi) activeEditorLi.remove();

      const isSub = clickedLi.classList.contains("subtask-item");
      const editorLi  = document.createElement("li");
      editorLi.className = isSub ? "subtask-item" : "task-item";

      const div = document.createElement("div");
      div.className = "task-content";

      const sel = document.createElement("select");
      sel.className = "form-select w-auto me-2";
      sel.innerHTML = `
        <option value="task">Tarea</option>
        <option value="subtask">Subtarea</option>
        <option value="comment">Comentario</option>
      `;

      const input = document.createElement("input");
      input.type = "text";
      input.className = "form-control me-2";
      input.placeholder = "Contenido…";

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn me-2";
      addBtn.textContent = "Añadir";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "btn";
      cancelBtn.textContent = "Cancelar";

      div.append(sel, input, addBtn, cancelBtn);
      editorLi.append(div);
      clickedLi.insertAdjacentElement("afterend", editorLi);
      activeEditorLi = editorLi;

      cancelBtn.addEventListener("click", () => {
        editorLi.remove();
        activeEditorLi = null;
      });

      addBtn.addEventListener("click", async () => {
        const texto = input.value.trim();
        if (!texto) return;
        const tipo = sel.value;

        /* --- Determinar parentId & siblings --- */
        let parentId = null;

        if (tipo === "subtask") {
          parentId = clickedDoc.parent ? clickedDoc.parent : clickedDoc.id;
        }

        const siblings = docs
          .filter(d => (d.parent || null) === parentId)
          .sort((a, b) => a.order - b.order);

        const idx = siblings.findIndex(d => d.id === clickedDoc.id);

        let newOrder;
        if (idx !== -1) {
          // Insertar justo debajo del clicado
          if (idx + 1 < siblings.length) {
            newOrder = (siblings[idx].order + siblings[idx + 1].order) / 2;
          } else {
            newOrder = siblings[idx].order + 1;
          }
        } else {
          // Clicado no está en siblings (subtarea sobre tarea padre, etc.)
          newOrder = siblings.reduce((m, d) => d.order > m ? d.order : m, 0) + 1;
        }

        const data = {
          text: texto,
          ts: Date.now(),
          order: newOrder,
          ...(parentId ? { parent: parentId } : {})
        };

        if (tipo === "comment") {
          data.note = true;
        } else {
          data.completed = false;
        }

        await addDoc(tareasRef, data);
        editorLi.remove();
        activeEditorLi = null;
      });
    };

    const containers = {};

    /* -------- Render tareas de nivel superior -------- */
    tasks.forEach(({ id, text, completed, note, order }) => {
      const li = document.createElement("li");
      li.className = "task-item";
      const div = document.createElement("div");
      div.className = "task-content";

      const span = document.createElement("span");
      const textClass = note ? "comment-text" : "task-text";
      span.className = textClass + (completed ? " completed" : "");
      span.innerHTML = parseMarkup(text);

      if (!note) {
        const cb   = mkCheckbox(id, completed);
        const plus = mkBtn("plus-lg", () => openInlineEditor(li, { id, parent: null, order }));
        const up   = mkBtn("chevron-up",   () => moveTask(id, null, "up"));
        const down = mkBtn("chevron-down", () => moveTask(id, null, "down"));
        const del  = mkBtn("x-lg",         () => deleteDoc(doc(tareasRef, id)));
        div.append(cb, span, plus, up, down, del);
      } else {
        const plus = mkBtn("plus-lg", () => openInlineEditor(li, { id, parent: null, order }));
        const up   = mkBtn("chevron-up",   () => moveTask(id, null, "up"));
        const down = mkBtn("chevron-down", () => moveTask(id, null, "down"));
        const del  = mkBtn("x-lg",         () => deleteDoc(doc(tareasRef, id)));
        div.append(span, plus, up, down, del);
      }

      li.append(div);

      const subUl = document.createElement("ul");
      subUl.className = "subtask-list";
      li.append(subUl);

      list.append(li);
      containers[id] = subUl;
    });

    /* -------- Render subtareas -------- */
    tasks.forEach(task => {
      const subUl = containers[task.id];
      subtasks
        .filter(s => s.parent === task.id)
        .sort((a, b) => a.order - b.order)
        .forEach(({ id, text, completed, parent, order }) => {
          const li = document.createElement("li");
          li.className = "subtask-item";
          const div = document.createElement("div");
          div.className = "task-content";

          const cb   = mkCheckbox(id, completed);
          const span = document.createElement("span");
          span.className = "task-text" + (completed ? " completed" : "");
          span.innerHTML = parseMarkup(text);

          const plus = mkBtn("plus-lg",      () => openInlineEditor(li, { id, parent, order }));
          const up   = mkBtn("chevron-up",   () => moveTask(id, parent, "up"));
          const down = mkBtn("chevron-down", () => moveTask(id, parent, "down"));
          const del  = mkBtn("x-lg",         () => deleteDoc(doc(tareasRef, id)));

          div.append(cb, span, plus, up, down, del);
          li.append(div);
          subUl.append(li);
        });
    });
  });
}
