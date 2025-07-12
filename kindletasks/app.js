/* =========================================================================
 *  app.js  —  Web de tareas con Bootstrap + Firestore
 *  ———————————————————————————————————————————————————————————————
 *  • Inicia sesión anónima (“login invisible”)
 *  • Reglas Firestore:  allow read,write: if request.auth != null;
 *  • Cada tarea tiene: text, ts, done, uid
 * ======================================================================= */

/* 1. Firebase SDK imports (v10+)  */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js";

/* 2. ¡Pega aquí tu propia configuración!  */
const firebaseConfig = {
  apiKey: "AIzaSyAlBA_fpzJvWobC3oqdZnTdzSvxDJHDwZI",
  authDomain: "unoriginal-tasks.firebaseapp.com",
  projectId: "unoriginal-tasks",
  storageBucket: "unoriginal-tasks.firebasestorage.app",
  messagingSenderId: "699262931203",
  appId: "1:699262931203:web:aac24b8fd3c5eba0ea9936"
};

/* 3. Inicializa Firebase, Auth y Firestore */
const app       = initializeApp(firebaseConfig);
const auth      = getAuth(app);
const db        = getFirestore(app);
const tareasRef = collection(db, "tareas");

/* -----------------------------------------------------------------------
 * 4.  Login anónimo (¡sin UI de login!)
 * --------------------------------------------------------------------- */
signInAnonymously(auth).catch((err) => {
  console.error("Error al iniciar sesión anónima:", err);
});

/* -----------------------------------------------------------------------
 * 5.  Una vez autenticado el usuario…
 * --------------------------------------------------------------------- */
onAuthStateChanged(auth, (user) => {
  if (!user) return;          // improbable, pero por si acaso
  const uid = user.uid;

  /* ---------- 5.a  Enviar una nueva tarea ---------- */
  document
    .getElementById("form")
    .addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.text;
      const texto = input.value.trim();
      if (!texto) return;

      try {
        await addDoc(tareasRef, {
          text: texto,
          ts:   Date.now(),
          done: false,
          uid            // dueño de la tarea (opcional para filtros futuros)
        });
        input.value = "";    // limpia el campo
      } catch (err) {
        console.error("No se pudo añadir la tarea:", err);
      }
    });

  /* ---------- 5.b  Escuchar la colección en tiempo real ---------- */
  onSnapshot(
    query(tareasRef, orderBy("ts", "desc")),
    (snapshot) => {
      const ul = document.getElementById("list");
      ul.innerHTML = "";     // borra la lista y la repinta
      snapshot.forEach((docSnap) => renderItem(docSnap));
    },
    (err) => console.error("Listener Firestore:", err)
  );
});

/* =======================================================================
 * 6.  Función de renderizado de cada tarea
 * ===================================================================== */
function renderItem(docSnap) {
  const data = docSnap.data();       // {text, ts, done, uid}
  const li   = document.createElement("li");
  li.className = "list-group-item d-flex align-items-center";

  /* — Checkbox para marcar completado — */
  const chk = document.createElement("input");
  chk.type  = "checkbox";
  chk.className = "form-check-input me-3";
  chk.checked   = data.done;

  /* — Texto de la tarea — */
  const span = document.createElement("span");
  span.textContent = data.text;
  if (data.done) span.classList.add("done");   // clase CSS con tachado

  /* — Evento toggle — */
  chk.addEventListener("change", () => {
    updateDoc(doc(tareasRef, docSnap.id), { done: chk.checked })
      .catch(err => console.error("No se pudo actualizar 'done':", err));
  });

  /* — Montaje en el DOM — */
  li.append(chk, span);
  document.getElementById("list").appendChild(li);
}
