// src/features/exportImport.js
import { el } from "../ui/domRefs.js";
import { createModuleBlock } from "../ui/modulesModal.js";
import { addNoteIndicator } from "./notes.js";
import { setIdeaMessage } from "../ui/modulesModal.js";
import { customSetClearAll } from "../ui/modulesModal.js";

let saveTimer = null;

const WIREFRAMER_DB = "wireframer";
const DRAFTS_STORE = "drafts";
const DRAFT_KEY = "autosave";

function openWireframerDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WIREFRAMER_DB, 2);

    req.onupgradeneeded = () => {
      const db = req.result;

      if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
        db.createObjectStore(DRAFTS_STORE, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveDraftToDb(data) {
  const db = await openWireframerDB();
  const tx = db.transaction(DRAFTS_STORE, "readwrite");
  tx.objectStore(DRAFTS_STORE).put({
    id: DRAFT_KEY,
    modules: data,
    updatedAt: Date.now(),
  });

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadDraftFromDb() {
  const db = await openWireframerDB();
  const tx = db.transaction(DRAFTS_STORE, "readonly");
  const req = tx.objectStore(DRAFTS_STORE).get(DRAFT_KEY);

  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function clearDraftFromDb() {
  const db = await openWireframerDB();
  const tx = db.transaction(DRAFTS_STORE, "readwrite");
  tx.objectStore(DRAFTS_STORE).delete(DRAFT_KEY);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function initExportImport() {
  el.exportBtn().addEventListener("click", exportMockup);
  el.importBtn().addEventListener("click", () => el.importFileInput().click());
  el.importFileInput().addEventListener("change", importMockup);
  document.getElementById("getListBtn").addEventListener("click", getModuleList);

  // NEW: hook Clear
  if (el.clearBtn()) el.clearBtn().addEventListener("click", clearCanvasAndStorage);

  // NEW: try restore on load
  tryRestoreDraft();

  // NEW: autosave on any canvas change (add/remove/reorder/notes/ideas/attrs)
  initAutosaveObserver();
}

/* -------------------- Shared helpers -------------------- */
function serializeCanvas() {
  return Array.from(document.querySelectorAll("#canvas .block-container")).map((block) => {
    const elc = block.querySelector(":first-child");
    return {
      category: elc.dataset.category,
      desktop: elc.dataset.desktop,
      mobile: elc.dataset.mobile,
      cols: elc.dataset.cols,
      height: elc.dataset.height,
      padding: elc.dataset.padding,
      gap: elc.dataset.gap,
      note: block.dataset.note,
      idea: block.dataset.idea || "",
    };
  });
}

function rebuildCanvas(modules) {
  const canvas = document.getElementById("canvas");
  canvas.innerHTML = "";
  modules.forEach(({ category, desktop, mobile, note, idea, cols, height, padding, gap }) => {
    const block = createModuleBlock(category, { desktop, mobile, cols, height, padding, gap });
    if (note && note.trim() !== "") {
      block.dataset.note = note;
      addNoteIndicator(block);
    }
    if (idea && idea.trim() !== "") {
      block.dataset.idea = idea;
      setIdeaMessage(block, idea);
    }
    canvas.appendChild(block);
  });
}

/* -------------------- Export / Import (existing) -------------------- */
export function exportMockup() {
  const modules = serializeCanvas();
  const blob = new Blob([JSON.stringify(modules, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: "mockup.json" });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function importMockup(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const modules = JSON.parse(ev.target.result);
      rebuildCanvas(modules);
      // NEW: persist immediately after importing
      saveDraft();
    } catch (err) {
      alert("Error loading mockup: " + err);
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

/* -------------------- Module list (existing) -------------------- */
export function getModuleList() {
  const list = Array.from(document.querySelectorAll("#canvas .block-container")).map((block) => {
    const elc = block.querySelector(":first-child");
    const category = elc.dataset.category;
    let name = elc.dataset.desktop;

    if (category === "Spacers") {
      name = elc.dataset.mobile + "px Spacer";
    } else if (category === "Custom") {
      name = elc.dataset.moduleName;
    } else if (category === "FreeForm" || category === "Free Form") {
      name = `${elc.dataset.cols} cols`;
    } else {
      name = elc.dataset.desktop.replace(".svg", "");
    }

    const note = (block.dataset.note || "").trim();
    const idea = (block.dataset.idea || "").trim();

    return { name, note, idea };
  });

  const html = list
    .map(
      ({ name, note, idea }) => `
    <div class="module-entry">
      <div class="module-name">${name}</div>
      ${idea ? `<div class="module-idea">💡 ${idea}</div>` : ""}
      ${note ? `<div class="module-note ql-editor">${note}</div>` : ""}
    </div>`,
    )
    .join("");

  el.moduleListContainer().innerHTML = html;
  bootstrap.Modal.getOrCreateInstance(document.getElementById("listModal")).show();
}

async function saveDraft() {
  try {
    const data = serializeCanvas();
    await saveDraftToDb(data);
  } catch (e) {
    console.warn("Autosave failed:", e);
  }
}

async function tryRestoreDraft() {
  try {
    const draft = await loadDraftFromDb();
    const data = draft?.modules;
    if (Array.isArray(data)) {
      rebuildCanvas(data);
    }
  } catch (e) {
    console.warn("Restore failed:", e);
  }
}

async function clearCanvasAndStorage() {
  if (!confirm("Clear the canvas and remove the saved draft?")) return;
  document.getElementById("canvas").innerHTML = "";
  try {
    await clearDraftFromDb();
  } catch (_) {}

  // NEW: also clear Custom Set library (IndexedDB)
  try {
    await customSetClearAll();
  } catch (e) {
    console.warn("Could not clear Custom Set library:", e);
  }
}

function initAutosaveObserver() {
  const canvas = document.getElementById("canvas");
  const observer = new MutationObserver(() => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraft, 150);
  });

  observer.observe(canvas, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-note", "data-idea", "data-category", "data-desktop", "data-mobile", "data-cols", "data-height", "data-padding", "data-gap"],
  });

  // Also autosave on window unload as a last resort
  window.addEventListener("beforeunload", saveDraft);
}
