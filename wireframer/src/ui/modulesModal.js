// src/ui/modulesModal.js
import { state } from "../state/viewState.js";
import { el } from "./domRefs.js";
import { categories } from "../data/categories.js";
import { addNoteIndicator } from "../features/notes.js";

// =====================
// Custom Set (IndexedDB)
// =====================
const CUSTOMSET_DB = "wireframer";
const CUSTOMSET_STORE = "customSetModules";

function openCustomSetDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CUSTOMSET_DB, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CUSTOMSET_STORE)) {
        db.createObjectStore(CUSTOMSET_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function customSetAddFiles(fileList) {
  const db = await openCustomSetDB();
  const files = Array.from(fileList || []);
  const tx = db.transaction(CUSTOMSET_STORE, "readwrite");
  const store = tx.objectStore(CUSTOMSET_STORE);

  // Store as Blob (not base64) to keep storage smaller
  for (const file of files) {
    const name = (file.name || "module").replace(/\.[^/.]+$/, ""); // remove extension
    store.add({
      name,
      type: file.type,
      blob: file,
    });
  }

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function customSetGetAll() {
  const db = await openCustomSetDB();
  const tx = db.transaction(CUSTOMSET_STORE, "readonly");
  const store = tx.objectStore(CUSTOMSET_STORE);
  const req = store.getAll();

  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function customSetClearAll() {
  const db = await openCustomSetDB();
  const tx = db.transaction(CUSTOMSET_STORE, "readwrite");
  tx.objectStore(CUSTOMSET_STORE).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// === Inline SVG helpers ===
async function loadInlineSvg(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("SVG not found: " + url);
  const text = await res.text();

  const wrap = document.createElement("div");
  wrap.innerHTML = text.trim();
  const svg = wrap.querySelector("svg");
  if (!svg) throw new Error("Invalid SVG: " + url);

  return svg;
}

/**
 * Replaces a given node (usually an <img>) with an inline <svg>.
 * - Keeps the dataset attributes we rely on (category, desktop, mobile, etc.)
 * - Applies the same "module-image" styling
 * - Updates global state references if needed
 */
export async function replaceWithInlineSvg(oldNode, url) {
  const svg = await loadInlineSvg(url);

  // carry over classes and styles used elsewhere
  svg.classList.add("module-image");
  svg.style.display = "block";
  svg.style.margin = "0";
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";

  // keep datasets we depend on
  svg.dataset.category = oldNode.dataset.category;
  svg.dataset.desktop = oldNode.dataset.desktop;
  svg.dataset.mobile = oldNode.dataset.mobile;
  if (oldNode.dataset.moduleName) svg.dataset.moduleName = oldNode.dataset.moduleName;

  // swap in the DOM
  oldNode.replaceWith(svg);

  // if something in state pointed to the previous node, point it to the new one
  if (state.currentlySwappingBlock === oldNode) state.currentlySwappingBlock = svg;

  // NEW: dispatch event so Preview Mode can process this svg immediately
  try {
    const ev = new CustomEvent("svg:inlined", { detail: { svg } });
    document.dispatchEvent(ev);
  } catch (_) {}

  return svg;
}

export function initModulesModal() {
  el.modulesModal().addEventListener("show.bs.modal", () => populateModulesModal());
}

export function populateModulesModal() {
  // Reset views
  const grid = el.categoryGrid();
  const view = el.categoryView();
  const list = el.categoryModulesList();

  grid.innerHTML = "";
  list.innerHTML = "";
  el.selectedCategoryIcon().style.display = "none";
  el.selectedCategoryTitle().textContent = "";

  grid.style.display = "";
  view.style.display = "none";

  // Build grid tiles
  categories.forEach((catObj, idx) => {
    const { category, icon } = catObj;
    const iconSrc = icon ? (icon.includes("/") ? icon : `CategoryIcons/${icon}`) : null;

    const col = document.createElement("div");
    col.className = "col-6 col-md-4 col-lg-3";

    const tile = document.createElement("div");
    tile.className = "cat-grid-tile";
    tile.setAttribute("role", "button");
    tile.setAttribute("tabindex", "0");
    tile.addEventListener("click", () => showCategory(idx));
    tile.addEventListener("keypress", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        showCategory(idx);
      }
    });

    tile.innerHTML = `
      ${iconSrc ? `<img class="cat-grid-icon" src="${iconSrc}" alt="${category} icon" />` : `<i class="bi bi-grid-3x3-gap fs-4 d-block mb-2"></i>`}
      <div class="cat-grid-name">${category}</div>
    `;

    col.appendChild(tile);
    grid.appendChild(col);
  });

  // Back button
  el.backToGridBtn().onclick = () => {
    // Return to the grid
    el.categoryModulesList().innerHTML = "";
    el.selectedCategoryIcon().style.display = "none";
    el.selectedCategoryTitle().textContent = "";
    grid.style.display = "";
    view.style.display = "none";
  };
}

function showCategory(index) {
  const grid = el.categoryGrid();
  const view = el.categoryView();
  const list = el.categoryModulesList();

  const catObj = categories[index];
  const { category, icon, files } = catObj;

  // Header with icon + name + back button is already in DOM; we just fill it.
  const iconSrc = icon ? (icon.includes("/") ? icon : `CategoryIcons/${icon}`) : null;
  if (iconSrc) {
    el.selectedCategoryIcon().src = iconSrc;
    el.selectedCategoryIcon().alt = `${category} icon`;
    el.selectedCategoryIcon().style.display = "";
  } else {
    el.selectedCategoryIcon().style.display = "none";
  }
  el.selectedCategoryTitle().textContent = category;

  // Build the body list for this category
  list.innerHTML = "";

  // For consistency with the previous UI, we include the same module-item containers
  if (category === "Custom") {
    list.appendChild(buildCustomInsert());
  } else if (category === "Custom Set") {
    list.appendChild(buildCustomSetInsert(list));
  } else if (category === "Free Form") {
    list.appendChild(buildFreeFormInsert());
  } else {
    files.forEach((fileObj) => {
      const wrap = document.createElement("div");
      wrap.className = "module-item-container";
      if (state.viewMode === "mobile") wrap.classList.add("mobile-mode");

      const title = document.createElement("div");
      title.className = "module-title";
      if (category === "Spacers") {
        title.innerText = `${state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop}px Spacer`;
      } else {
        const file = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
        title.innerText = file.replace(".svg", "");
      }
      wrap.appendChild(title);

      let preview;
      if (category === "Spacers") {
        const h = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
        preview = document.createElement("div");
        Object.assign(preview.style, {
          height: h + "px",
          background: "#d3d3d3",
          width: state.viewMode === "desktop" ? "1500px" : "360px",
        });
      } else {
        const file = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
        preview = document.createElement("img");
        preview.src = `Modules/${category}/${file}`;
        preview.alt = file;
        preview.className = "img-fluid module-item-thumb module-image";
        preview.style.cursor = "pointer";
      }
      wrap.appendChild(preview);

      if (fileObj.tags?.length) {
        const tags = document.createElement("div");
        tags.className = "module-tags";
        fileObj.tags.forEach((t) => {
          const s = document.createElement("span");
          s.className = "module-tag";
          s.innerText = t;
          tags.appendChild(s);
        });
        wrap.appendChild(tags);
      }

      wrap.onclick = () => {
        if (state.currentlySwappingBlock) updateBlockSrc(state.currentlySwappingBlock, category, fileObj);
        else if (state.currentlyInsertingBlockAfter) addModuleAfter(state.currentlyInsertingBlockAfter, category, fileObj);
        else addModuleToCanvas(category, fileObj);
      };

      list.appendChild(wrap);
    });
  }

  // Toggle views
  grid.style.display = "none";
  view.style.display = "";
}

/* ===== Canvas operations (unchanged from previous behavior) ===== */

export function createModuleBlock(category, fileObj) {
  const blockDiv = document.createElement("div");
  blockDiv.className = "block-container";
  if (category === "Spacers") blockDiv.classList.add("spacer-block");

  let node,
    moduleName = "";
  if (category === "Spacers") {
    const h = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    moduleName = `${h}px Spacer`;
    node = document.createElement("div");
    Object.assign(node.style, {
      height: h + "px",
      background: "#ffffff",
      width: state.viewMode === "desktop" ? "1500px" : "360px",
    });
  } else if (category === "FreeForm") {
    moduleName = `${fileObj.cols} cols`;
    node = document.createElement("div");
    node.className = "freeform-wrapper";
    node.style.display = "grid";
    node.style.gridTemplateColumns = `repeat(${fileObj.cols}, 1fr)`;
    node.style.gap = `${fileObj.gap}px`;
    node.style.padding = `0 ${fileObj.padding}px`; // ← solo padding horizontal
    // node.style.background = "#e5e5e5";
    node.style.height = `${fileObj.height}px`;
    node.style.width = state.viewMode === "desktop" ? "1500px" : "360px";

    node.dataset.category = "FreeForm";
    node.dataset.cols = fileObj.cols;
    node.dataset.height = fileObj.height;
    node.dataset.padding = fileObj.padding;
    node.dataset.gap = fileObj.gap;

    for (let i = 0; i < fileObj.cols; i++) {
      const col = document.createElement("div");
      col.className = "freeform-column";
      col.style.background = "#e3e3e3";
      col.style.height = "100%";
      node.appendChild(col);
    }

    try {
      const ev = new CustomEvent("freeform:created", { detail: { wrapper: node } });
      document.dispatchEvent(ev);
    } catch (_) {}
  } else if (category === "Custom") {
    const fileName = fileObj.customName;
    moduleName = fileName;
    node = document.createElement("img");
    node.src = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    node.alt = fileName;
    node.className = "module-image";
    Object.assign(node.style, { display: "block", margin: "0", maxWidth: "100%", height: "auto" });
  } else {
    const file = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    moduleName = file.replace(".svg", "");

    // start with a temporary element we can swap
    node = document.createElement("img");
    node.alt = file;
    node.className = "module-image";
    Object.assign(node.style, { display: "block", margin: "0", maxWidth: "100%", height: "auto" });

    // after the datasets are set below, we inline the SVG
    // (we must build the data-* first so replaceWithInlineSvg can copy them)
    queueMicrotask(() => {
      const url = `Modules/${category}/${file}`;
      replaceWithInlineSvg(node, url).catch(console.error);
    });
  }

  node.dataset.category = category;
  node.dataset.desktop = fileObj.desktop;
  node.dataset.mobile = fileObj.mobile;
  if (category === "Custom") node.dataset.moduleName = fileObj.customName;
  blockDiv.dataset.note = "";
  blockDiv.dataset.idea = fileObj.idea || "";
  blockDiv.appendChild(node);

  // overlay
  const overlay = document.createElement("div");
  overlay.className = "module-overlay";

  const label = document.createElement("div");
  label.className = "module-name-label";
  label.innerText = moduleName;
  overlay.appendChild(label);

  // NUEVO: cajita de mensaje SIEMPRE visible si hay texto
  const ideaMsg = document.createElement("div");
  ideaMsg.className = "idea-message";
  blockDiv.appendChild(ideaMsg);

  const icons = document.createElement("div");
  icons.className = "overlay-icons";

  const del = iconBtn("bi-x-circle-fill", "Delete", (e) => {
    e.stopPropagation();
    blockDiv.remove();
  });

  const swap = iconBtn("bi-arrow-repeat", "Swap Module", (e) => {
    e.stopPropagation();
    const current = e.currentTarget.closest(".block-container");
    state.currentlySwappingBlock = current; // ← guardamos el CONTENEDOR
    showModules();
  });

  // const clone = iconBtn("bi-files", "Clone Module", (e) => { e.stopPropagation(); cloneBlock(blockDiv); });
  const clone = iconBtn("bi-files", "Clone Module", (e) => {
    e.stopPropagation();
    const current = e.currentTarget.closest(".block-container");
    cloneBlock(current);
  });

  const addAfter = iconBtn("bi-plus-circle", "Add Module After", (e) => {
    e.stopPropagation();
    state.currentlyInsertingBlockAfter = blockDiv;
    showModules();
  });
  const note = iconBtn("bi-chat-dots", "Add/View Note", (e) => {
    e.stopPropagation();
    state.currentlyEditingNoteBlock = blockDiv;
    state.quill.root.innerHTML = blockDiv.dataset.note;
    bootstrap.Modal.getOrCreateInstance(document.getElementById("noteModal")).show();
  });

  const idea = iconBtn("bi-lightbulb", "Añadir/Ver idea", (e) => {
    e.stopPropagation();
    state.currentlyEditingIdeaBlock = blockDiv;
    el.ideaInput().value = blockDiv.dataset.idea || "";
    bootstrap.Modal.getOrCreateInstance(el.ideaModal()).show();
  });

  [del, swap, clone, addAfter, note, idea].forEach((b) => icons.appendChild(b));
  overlay.appendChild(icons);
  blockDiv.appendChild(overlay);

  if (blockDiv.dataset.note.trim() !== "") addNoteIndicator(blockDiv);
  setIdeaMessage(blockDiv, blockDiv.dataset.idea);
  return blockDiv;
}

export function setIdeaMessage(blockDiv, text) {
  const badge = blockDiv.querySelector(".idea-message");
  if (!badge) return;
  const t = (text || "").trim();
  if (t) {
    badge.textContent = t;
    badge.style.display = "block"; // SIEMPRE visible si hay texto
  } else {
    badge.textContent = "";
    badge.style.display = "none";
  }
}

export function addModuleToCanvas(category, fileObj) {
  el.canvas().appendChild(createModuleBlock(category, fileObj));
  closeModules();
}

export function addModuleAfter(refBlock, category, fileObj) {
  refBlock.insertAdjacentElement("afterend", createModuleBlock(category, fileObj));
  closeModules();
  state.currentlyInsertingBlockAfter = null;
}

export function updateBlockSrc(targetRef, category, fileObj) {
  // Permite pasar o bien el .block-container o bien un hijo suyo
  if (!targetRef || !(targetRef instanceof Element)) {
    console.warn("Swap target is invalid. Resetting swap state.");
    state.currentlySwappingBlock = null;
    closeModules();
    return;
  }
  let blockDiv = targetRef.classList?.contains("block-container") ? targetRef : targetRef.closest(".block-container");

  if (!blockDiv || !blockDiv.isConnected) {
    console.warn("Swap target is not connected to the DOM. Resetting swap state.");
    state.currentlySwappingBlock = null;
    closeModules();
    return;
  }

  // siempre resolvemos el primer hijo actual
  let node = blockDiv.querySelector(":first-child");
  const label = blockDiv.querySelector(".module-name-label");

  // helper por si el bloque estuviera “vacío”: creamos un nodo base según categoría
  function ensureBaseNodeForCategory(cat) {
    if (node) return node;
    if (cat === "Spacers" || cat === "FreeForm") {
      node = document.createElement("div");
    } else {
      node = document.createElement("img");
      node.className = "module-image";
      Object.assign(node.style, { display: "block", margin: "0", maxWidth: "100%", height: "auto" });
    }
    blockDiv.prepend(node);
    return node;
  }

  // Helper: reemplazar el elemento por otro (manteniendo overlay, notas, idea, etc.)
  function replaceNode(newNode) {
    blockDiv.replaceChild(newNode, node);
    return newNode;
  }

  // === 1) FREE FORM ===
  if (category === "FreeForm") {
    ensureBaseNodeForCategory("FreeForm");
    let target = node;

    // Si el actual NO es un FreeForm, creamos uno y reemplazamos
    if (node.dataset.category !== "FreeForm") {
      const nf = document.createElement("div");
      nf.className = "freeform-wrapper";
      target = replaceNode(nf);
    }

    // Aplicar estilo y datasets al (nuevo) freeform
    target.style.display = "grid";
    target.style.gridTemplateColumns = `repeat(${fileObj.cols}, 1fr)`;
    target.style.gap = `${fileObj.gap}px`;
    target.style.padding = `0 ${fileObj.padding}px`; // solo horizontal
    target.style.height = `${fileObj.height}px`;
    target.style.width = state.viewMode === "desktop" ? "1500px" : "360px";

    target.dataset.category = "FreeForm";
    target.dataset.cols = fileObj.cols;
    target.dataset.height = fileObj.height;
    target.dataset.padding = fileObj.padding;
    target.dataset.gap = fileObj.gap;

    // Reconstruir columnas
    target.innerHTML = "";
    for (let i = 0; i < fileObj.cols; i++) {
      const col = document.createElement("div");
      col.className = "freeform-column";
      col.style.background = "#e3e3e3";
      col.style.height = "100%";
      target.appendChild(col);
    }

    try {
      const ev = new CustomEvent("freeform:created", { detail: { wrapper: target } });
      document.dispatchEvent(ev);
    } catch (_) {}

    if (label) label.innerText = `${fileObj.cols} cols`;

    // NEW: actualizar idea si viene en el payload
    if (typeof fileObj.idea !== "undefined") {
      blockDiv.dataset.idea = fileObj.idea || "";
      setIdeaMessage(blockDiv, blockDiv.dataset.idea);
    }

    closeModules();
    state.currentlySwappingBlock = null;
    return;
  }

  // === 2) SPACERS ===
  if (category === "Spacers") {
    ensureBaseNodeForCategory("Spacers");
    const h = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;

    // si el nodo actual no es un spacer (div "cuadro" simple), conviértelo a div
    if (node.dataset.category !== "Spacers") {
      const d = document.createElement("div");
      Object.assign(d.style, {
        height: h + "px",
        background: "#ffffff",
        width: state.viewMode === "desktop" ? "1500px" : "360px",
      });
      d.dataset.category = "Spacers";
      d.dataset.desktop = fileObj.desktop;
      d.dataset.mobile = fileObj.mobile;
      node = replaceNode(d);
    } else {
      Object.assign(node.style, {
        height: h + "px",
        background: "#ffffff",
        width: state.viewMode === "desktop" ? "1500px" : "360px",
      });
      node.dataset.desktop = fileObj.desktop;
      node.dataset.mobile = fileObj.mobile;
    }

    if (label) label.innerText = `${h}px Spacer`;
    closeModules();
    state.currentlySwappingBlock = null;
    return;
  }

  // === 3) CUSTOM o MÓDULOS DE IMAGEN ===
  // Asegura que el nodo sea <img> si vamos a mostrar imagen
  function ensureImg() {
    if (node.tagName !== "IMG") {
      const img = document.createElement("img");
      img.className = "module-image";
      Object.assign(img.style, { display: "block", margin: "0", maxWidth: "100%", height: "auto" });
      node = replaceNode(img);
    }
    return node;
  }

  ensureBaseNodeForCategory(category);

  node = ensureImg();

  if (category === "Custom") {
    const fileName = fileObj.customName;
    node.src = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    node.alt = fileName;
    node.dataset.category = "Custom";
    node.dataset.desktop = fileObj.desktop;
    node.dataset.mobile = fileObj.mobile;
    node.dataset.moduleName = fileName;
    if (label) label.innerText = fileName;
  } else {
    // Normal categories with SVG -> inline them
    const file = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;

    // ensure the element exists (it might be IMG or SVG from previous state)
    if (!(node instanceof Element)) {
      const img = document.createElement("img");
      img.className = "module-image";
      Object.assign(img.style, { display: "block", margin: "0", maxWidth: "100%", height: "auto" });
      node = replaceNode(img);
    }

    node.dataset.category = category;
    node.dataset.desktop = fileObj.desktop;
    node.dataset.mobile = fileObj.mobile;
    if (label) label.innerText = file.replace(".svg", "");

    // Now inline the right SVG
    replaceWithInlineSvg(node, `Modules/${category}/${file}`).catch(console.error);
  }

  closeModules();
  state.currentlySwappingBlock = null;
}

// export function cloneBlock(blockDiv) {
//   const clone = blockDiv.cloneNode(true);
//   clone.style.opacity = "1";
//   const [del, swap, cloneBtn, addAfter, note] = clone.querySelectorAll(".icon-btn");
//   const node = clone.querySelector(":first-child");
//   del.onclick = (e) => { e.stopPropagation(); clone.remove(); };
//   swap.onclick = (e) => { e.stopPropagation(); state.currentlySwappingBlock = node; showModules(); };
//   cloneBtn.onclick = (e) => { e.stopPropagation(); blockDiv.insertAdjacentElement("afterend", clone); }; // self-clone again if needed
//   addAfter.onclick = (e) => { e.stopPropagation(); state.currentlyInsertingBlockAfter = clone; showModules(); };
//   note.onclick = (e) => {
//     e.stopPropagation();
//     state.currentlyEditingNoteBlock = clone;
//     state.quill.root.innerHTML = clone.dataset.note;
//     bootstrap.Modal.getOrCreateInstance(document.getElementById("noteModal")).show();
//   };
//   clone.querySelector(".module-overlay").style.display = "";
//   if (blockDiv.dataset.note.trim() !== "") { clone.dataset.note = blockDiv.dataset.note; }
//   blockDiv.insertAdjacentElement("afterend", clone);
// }

export function cloneBlock(blockDiv) {
  const copy = blockDiv.cloneNode(true);
  copy.style.opacity = "1";

  // Rewire handlers so they act on THIS copy, not the original
  const node = copy.querySelector(":first-child");
  const [del, swap, cloneBtn, addAfter, note, idea] = copy.querySelectorAll(".icon-btn");

  // Delete this copy
  del.onclick = (e) => {
    e.stopPropagation();
    e.currentTarget.closest(".block-container").remove();
  };

  // Swap this copy
  swap.onclick = (e) => {
    e.stopPropagation();
    const current = e.currentTarget.closest(".block-container");
    state.currentlySwappingBlock = current; // ← contenedor
    showModules();
  };

  // Clone THIS copy (not the original)
  cloneBtn.onclick = (e) => {
    e.stopPropagation();
    const current = e.currentTarget.closest(".block-container");
    cloneBlock(current);
  };

  // Add module after THIS copy
  addAfter.onclick = (e) => {
    e.stopPropagation();
    state.currentlyInsertingBlockAfter = copy;
    showModules();
  };

  // Notes for THIS copy
  note.onclick = (e) => {
    e.stopPropagation();
    const current = e.currentTarget.closest(".block-container");
    state.currentlyEditingNoteBlock = current;
    state.quill.root.innerHTML = current.dataset.note;
    bootstrap.Modal.getOrCreateInstance(document.getElementById("noteModal")).show();
  };

  idea.onclick = (e) => {
    e.stopPropagation();
    const current = e.currentTarget.closest(".block-container");
    state.currentlyEditingIdeaBlock = current;
    el.ideaInput().value = current.dataset.idea || "";
    bootstrap.Modal.getOrCreateInstance(el.ideaModal()).show();
  };

  // Make overlay visible on hover as usual
  const overlay = copy.querySelector(".module-overlay");
  if (overlay) overlay.style.display = "";

  // If the original had a note, the dataset & indicator are already cloned;
  // nothing else to do. Insert the copy right below the source.
  blockDiv.insertAdjacentElement("afterend", copy);
}

function showModules() {
  if (state.currentlySwappingBlock && !state.currentlySwappingBlock.isConnected) {
    state.currentlySwappingBlock = null;
  }
  bootstrap.Modal.getOrCreateInstance(el.modulesModal()).show();
}
function closeModules() {
  const m = bootstrap.Modal.getInstance(el.modulesModal());
  if (m) m.hide();
}

function iconBtn(icon, title, onclick) {
  const b = document.createElement("button");
  b.className = "icon-btn";
  b.title = title;
  b.innerHTML = `<i class="bi ${icon}"></i>`;
  b.onclick = onclick;
  return b;
}

/* ===== Custom insert builder (ported) ===== */
function buildCustomInsert() {
  // minimal port of the custom paste UI from original
  const wrap = document.createElement("div");
  wrap.className = "module-item-container custom-insert";
  wrap.innerHTML = `
    <div class="module-title">Insert clipping</div>
    <div class="custom-insert-row1">
      <div class="custom-field-group">
        <label>Module name</label>
        <input type="text" placeholder="Enter module name">
      </div>
      <div class="custom-btn-container"><button class="btn btn-outline-primary">Set Desktop Image</button></div>
      <div class="custom-btn-container"><button class="btn btn-outline-primary">Set Mobile Image</button></div>
      <div class="custom-btn-container"><button class="btn btn-primary">Create</button></div>
    </div>
    <div class="custom-insert-row2">
      <div class="custom-preview-container">
        <img class="image-preview" style="display:none">
        <button class="clear-preview-btn" style="display:none">✕</button>
      </div>
      <div class="custom-preview-container">
        <img class="image-preview" style="display:none">
        <button class="clear-preview-btn" style="display:none">✕</button>
      </div>
    </div>`;
  const [nameInput] = wrap.querySelectorAll("input");
  const [btnDesktop, btnMobile, btnCreate] = wrap.querySelectorAll(".custom-btn-container button");
  const [deskC, mobC] = wrap.querySelectorAll(".custom-preview-container");
  const deskImg = deskC.querySelector("img"),
    mobImg = mobC.querySelector("img");
  const deskX = deskC.querySelector("button"),
    mobX = mobC.querySelector("button");

  wrap.dataset.desktop = "";
  wrap.dataset.mobile = "";
  wrap.dataset.moduleName = "";

  function promptForImage(cb) {
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById("pasteModal"));
    modal.show();
    const handler = (event) => {
      const items = (event.clipboardData || event.originalEvent?.clipboardData)?.items || [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile();
          const r = new FileReader();
          r.onload = (e) => {
            cb(e.target.result);
            modal.hide();
          };
          r.readAsDataURL(blob);
          document.removeEventListener("paste", handler);
          return;
        }
      }
      modal.hide();
      document.removeEventListener("paste", handler);
      alert("No image found in clipboard.");
    };
    document.addEventListener("paste", handler);
  }

  btnDesktop.onclick = (e) => {
    e.stopPropagation();
    promptForImage((b64) => {
      wrap.dataset.desktop = b64;
      deskImg.src = b64;
      deskImg.style.display = "block";
      deskX.style.display = "block";
      btnDesktop.innerText = "Desktop Image Set";
    });
  };
  btnMobile.onclick = (e) => {
    e.stopPropagation();
    promptForImage((b64) => {
      wrap.dataset.mobile = b64;
      mobImg.src = b64;
      mobImg.style.display = "block";
      mobX.style.display = "block";
      btnMobile.innerText = "Mobile Image Set";
    });
  };
  deskX.onclick = (e) => {
    e.stopPropagation();
    wrap.dataset.desktop = "";
    deskImg.src = "";
    deskImg.style.display = "none";
    deskX.style.display = "none";
    btnDesktop.innerText = "Set Desktop Image";
  };
  mobX.onclick = (e) => {
    e.stopPropagation();
    wrap.dataset.mobile = "";
    mobImg.src = "";
    mobImg.style.display = "none";
    mobX.style.display = "none";
    btnMobile.innerText = "Set Mobile Image";
  };

  btnCreate.onclick = () => {
    const name = nameInput.value.trim() || "Insert Clipping";
    const desktop = wrap.dataset.desktop;
    let mobile = wrap.dataset.mobile;
    if (!desktop) {
      alert("Please provide at least a desktop image.");
      return;
    }
    if (!mobile) mobile = desktop;
    addModuleToCanvas("Custom", { desktop, mobile, customName: name, tags: [], isCustom: true });
  };

  return wrap;
}

function buildFreeFormInsert() {
  const wrap = document.createElement("div");
  wrap.className = "module-item-container custom-insert";
  wrap.innerHTML = `
    <div class="module-title">Free Form</div>
    <div class="custom-insert-row1">
      <div class="custom-field-group">
        <label>Nº Columns</label>
        <input type="number" min="1" max="12" value="1" class="freeform-columns">
      </div>
      <div class="custom-field-group">
        <label>Height (px)</label>
        <input type="number" min="20" max="2000" value="300" class="freeform-height">
      </div>
      <div class="custom-field-group">
        <label>Padding (px) (horizontal)</label>
        <input type="number" min="0" max="200" value="20" class="freeform-padding">
      </div>
      <div class="custom-field-group">
        <label>Gap (px)</label>
        <input type="number" min="0" max="100" value="16" class="freeform-gap">
      </div>
       <div class="custom-field-group" style="min-width:240px;">
         <label>Idea</label>
         <input type="text" placeholder="" class="freeform-idea">
       </div>
      <div class="custom-btn-container">
        <button class="btn btn-primary create-freeform-btn">Create</button>
      </div>
    </div>
  `;

  // AUTOCOMPLETAR SI VIENES DE SWAP Y EL NODO ES FREEFORM
  try {
    if (state.currentlySwappingBlock) {
      const n = state.currentlySwappingBlock;
      const isFree = n?.dataset?.category === "FreeForm";
      if (isFree) {
        const cols = parseInt(n.dataset.cols || "3", 10);
        const height = parseInt(n.dataset.height || "300", 10);
        const padding = parseInt(n.dataset.padding || "20", 10);
        const gap = parseInt(n.dataset.gap || "16", 10);
        wrap.querySelector(".freeform-columns").value = cols;
        wrap.querySelector(".freeform-height").value = height;
        wrap.querySelector(".freeform-padding").value = padding;
        wrap.querySelector(".freeform-gap").value = gap;
        wrap.querySelector(".freeform-idea").value = n.parentElement?.dataset?.idea || "";
      }
    }
  } catch (_) {}

  wrap.querySelector(".create-freeform-btn").onclick = () => {
    const cols = parseInt(wrap.querySelector(".freeform-columns").value, 10);
    const height = parseInt(wrap.querySelector(".freeform-height").value, 10);
    const padding = parseInt(wrap.querySelector(".freeform-padding").value, 10);
    const gap = parseInt(wrap.querySelector(".freeform-gap").value, 10);
    const idea = (wrap.querySelector(".freeform-idea").value || "").trim();

    if (!cols || cols < 1 || !height || height < 20) {
      alert("Please fill all values correctly.");
      return;
    }

    // Si estamos swappeando, ACTUALIZA el bloque actual; si no, crea uno nuevo
    if (state.currentlySwappingBlock) {
      updateBlockSrc(state.currentlySwappingBlock, "FreeForm", { cols, height, padding, gap, idea });
      return;
    }

    if (state.currentlyInsertingBlockAfter) {
      addModuleAfter(state.currentlyInsertingBlockAfter, "FreeForm", { cols, height, padding, gap, idea });
      return;
    }

    addModuleToCanvas("FreeForm", { cols, height, padding, gap, idea });
  };

  return wrap;
}

function buildCustomSetInsert(list) {
  const wrap = document.createElement("div");
  wrap.className = "module-item-container customset-root";
  wrap.innerHTML = `
    <div class="module-title">Custom Set</div>

    <div class="customset-actions">
      <button class="btn btn-primary customset-add-btn">Add Modules</button>
      <input type="file" class="customset-file" accept=".jpg,.jpeg,.png,.svg" multiple style="display:none">
    </div>

    <div class="customset-dropzone">
      <div><strong>Drop files here</strong> (JPG / SVG)</div>
      <div class="text-muted" style="font-size:.85rem;">You can add more any time</div>
    </div>

    <div class="customset-grid"></div>
  `;

  const btn = wrap.querySelector(".customset-add-btn");
  const input = wrap.querySelector(".customset-file");
  const dropzone = wrap.querySelector(".customset-dropzone");
  const grid = wrap.querySelector(".customset-grid");

  async function customSetDelete(id) {
    const db = await openCustomSetDB();
    const tx = db.transaction(CUSTOMSET_STORE, "readwrite");
    tx.objectStore(CUSTOMSET_STORE).delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function refresh() {
    const items = await customSetGetAll();

    // Clear area
    list.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "customset-empty";
      empty.innerHTML = `
      <div class="module-title">Custom Set</div>
      <div class="text-muted" style="margin: 0.5rem 0 1rem 0;">
        No modules yet.
      </div>
      <button class="btn btn-primary customset-add-btn-2">Add Modules</button>
    `;
      empty.querySelector(".customset-add-btn-2").onclick = () => input.click();
      list.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const wrap = document.createElement("div");
      wrap.className = "module-item-container customset-item-container";

      const title = document.createElement("div");
      title.className = "module-title";
      title.innerText = item.name || "Custom Module";
      wrap.appendChild(title);

      const preview = document.createElement("img");
      const url = URL.createObjectURL(item.blob);
      preview.src = url;
      preview.alt = item.name || "Custom Module";
      preview.className = "img-fluid module-item-thumb module-image";
      preview.style.cursor = "pointer";
      wrap.appendChild(preview);

      // Delete "X"
      const del = document.createElement("button");
      del.className = "customset-delete-btn";
      del.type = "button";
      del.title = "Delete module";
      del.innerHTML = `<i class="bi bi-x-lg"></i>`;
      del.onclick = async (e) => {
        e.stopPropagation();
        await customSetDelete(item.id);
        await refresh();
      };
      wrap.appendChild(del);

      // Click to add to canvas (as Custom -> base64)
      wrap.onclick = async () => {
        const dataUrl = await blobToDataURL(item.blob);
        const name = item.name || "Custom Module";
        addModuleToCanvas("Custom", {
          desktop: dataUrl,
          mobile: dataUrl,
          customName: name,
          tags: [],
          isCustom: true,
        });
      };

      list.appendChild(wrap);
    });
  }

  btn.onclick = () => input.click();

  input.onchange = async (e) => {
    const files = e.target.files;
    if (files && files.length) {
      await customSetAddFiles(files);
      await refresh();
    }
    input.value = "";
  };

  // Drag/drop support
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("is-over");
  });
  dropzone.addEventListener("dragleave", () => {
    dropzone.classList.remove("is-over");
  });
  dropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    dropzone.classList.remove("is-over");
    const files = e.dataTransfer?.files;
    if (files && files.length) {
      await customSetAddFiles(files);
      await refresh();
    }
  });

  // Initial load
  refresh().catch(console.error);

  return wrap;
}
