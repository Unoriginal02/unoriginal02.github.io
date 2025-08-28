// src/ui/modulesModal.js
import { state } from "../state/viewState.js";
import { el } from "./domRefs.js";
import { categories } from "../data/categories.js";
import { addNoteIndicator } from "../features/notes.js";

export function initModulesModal() {
  el.modulesModal().addEventListener("show.bs.modal", () => populateModulesModal());
}

export function populateModulesModal() {
  const tab = el.modulesTab(), content = el.modulesTabContent();
  tab.innerHTML = ""; content.innerHTML = "";
  categories.forEach((catObj, idx) => {
    const { category, files } = catObj;

    // Nav pill
    const li = document.createElement("li"); li.className = "nav-item"; li.role = "presentation";
    const btn = document.createElement("button");
    Object.assign(btn, { id:`tab-${idx}`, type:"button" });
    btn.className = "nav-link"; btn.dataset.bsToggle = "pill"; btn.dataset.bsTarget = `#pill-${idx}`;
    btn.role = "tab"; btn.ariaControls = `pill-${idx}`; btn.ariaSelected = idx===0 ? "true":"false";
    btn.innerText = category; li.appendChild(btn); tab.appendChild(li);

    // Pane
    const pane = document.createElement("div");
    pane.className = "tab-pane fade"; pane.id = `pill-${idx}`; pane.role = "tabpanel"; pane.ariaLabelledby = `tab-${idx}`;

    if (category === "Custom") {
      pane.appendChild(buildCustomInsert());
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
          const tags = document.createElement("div"); tags.className = "module-tags";
          fileObj.tags.forEach(t => { const s = document.createElement("span"); s.className = "module-tag"; s.innerText = t; tags.appendChild(s); });
          wrap.appendChild(tags);
        }

        wrap.onclick = () => {
          if (state.currentlySwappingBlock) updateBlockSrc(state.currentlySwappingBlock, category, fileObj);
          else if (state.currentlyInsertingBlockAfter) addModuleAfter(state.currentlyInsertingBlockAfter, category, fileObj);
          else addModuleToCanvas(category, fileObj);
        };

        pane.appendChild(wrap);
      });
    }
    content.appendChild(pane);
  });
}

export function createModuleBlock(category, fileObj) {
  const blockDiv = document.createElement("div");
  blockDiv.className = "block-container";
  if (category === "Spacers") blockDiv.classList.add("spacer-block");

  let node, moduleName = "";
  if (category === "Spacers") {
    const h = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    moduleName = `${h}px Spacer`;
    node = document.createElement("div");
    Object.assign(node.style, {
      height: h + "px",
      background: "#ffffff",
      width: state.viewMode === "desktop" ? "1500px" : "360px",
    });
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
    node = document.createElement("img");
    node.src = `Modules/${category}/${file}`;
    node.alt = file;
    node.className = "module-image";
    Object.assign(node.style, { display: "block", margin: "0", maxWidth: "100%", height: "auto" });
  }

  node.dataset.category = category;
  node.dataset.desktop = fileObj.desktop;
  node.dataset.mobile = fileObj.mobile;
  if (category === "Custom") node.dataset.moduleName = fileObj.customName;
  blockDiv.dataset.note = "";

  blockDiv.appendChild(node);

  // overlay
  const overlay = document.createElement("div"); overlay.className = "module-overlay";
  const label = document.createElement("div"); label.className = "module-name-label"; label.innerText = moduleName;
  overlay.appendChild(label);

  const icons = document.createElement("div"); icons.className = "overlay-icons";

  const del = iconBtn("bi-x-circle-fill", "Delete", (e) => { e.stopPropagation(); blockDiv.remove(); });
  const swap = iconBtn("bi-arrow-repeat", "Swap Module", (e) => { e.stopPropagation(); state.currentlySwappingBlock = node; showModules(); });
  const clone = iconBtn("bi-files", "Clone Module", (e) => { e.stopPropagation(); cloneBlock(blockDiv); });
  const addAfter = iconBtn("bi-plus-circle", "Add Module After", (e) => { e.stopPropagation(); state.currentlyInsertingBlockAfter = blockDiv; showModules(); });
  const note = iconBtn("bi-chat-dots", "Add/View Note", (e) => {
    e.stopPropagation();
    state.currentlyEditingNoteBlock = blockDiv;
    state.quill.root.innerHTML = blockDiv.dataset.note;
    bootstrap.Modal.getOrCreateInstance(document.getElementById("noteModal")).show();
  });

  [del, swap, clone, addAfter, note].forEach(b => icons.appendChild(b));
  overlay.appendChild(icons);
  blockDiv.appendChild(overlay);

  if (blockDiv.dataset.note.trim() !== "") addNoteIndicator(blockDiv);
  return blockDiv;
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

export function updateBlockSrc(node, category, fileObj) {
  if (category === "Spacers") {
    const h = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    Object.assign(node.style, { height: h + "px", background: "#ffffff", width: state.viewMode === "desktop" ? "1500px" : "360px" });
    node.dataset.desktop = fileObj.desktop; node.dataset.mobile = fileObj.mobile;
    node.parentElement.querySelector(".module-name-label").innerText = `${h}px Spacer`;
  } else {
    const file = state.viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    node.src = category === "Custom" ? fileObj.desktop : `Modules/${category}/${file}`;
    node.dataset.desktop = fileObj.desktop; node.dataset.mobile = fileObj.mobile;
    node.parentElement.querySelector(".module-name-label").innerText = category === "Custom" ? fileObj.customName : file.replace(".svg", "");
  }
  closeModules(); state.currentlySwappingBlock = null;
}

export function cloneBlock(blockDiv) {
  const clone = blockDiv.cloneNode(true);
  clone.style.opacity = "1";
  const [del, swap, cloneBtn, addAfter, note] = clone.querySelectorAll(".icon-btn");
  const node = clone.querySelector(":first-child");
  del.onclick = (e) => { e.stopPropagation(); clone.remove(); };
  swap.onclick = (e) => { e.stopPropagation(); state.currentlySwappingBlock = node; showModules(); };
  cloneBtn.onclick = (e) => { e.stopPropagation(); blockDiv.insertAdjacentElement("afterend", clone); }; // self-clone again if needed
  addAfter.onclick = (e) => { e.stopPropagation(); state.currentlyInsertingBlockAfter = clone; showModules(); };
  note.onclick = (e) => {
    e.stopPropagation();
    state.currentlyEditingNoteBlock = clone;
    state.quill.root.innerHTML = clone.dataset.note;
    bootstrap.Modal.getOrCreateInstance(document.getElementById("noteModal")).show();
  };
  clone.querySelector(".module-overlay").style.display = "";
  if (blockDiv.dataset.note.trim() !== "") { clone.dataset.note = blockDiv.dataset.note; }
  blockDiv.insertAdjacentElement("afterend", clone);
}

function showModules() { bootstrap.Modal.getOrCreateInstance(el.modulesModal()).show(); }
function closeModules() { const m = bootstrap.Modal.getInstance(el.modulesModal()); if (m) m.hide(); }

function iconBtn(icon, title, onclick) {
  const b = document.createElement("button");
  b.className = "icon-btn"; b.title = title; b.innerHTML = `<i class="bi ${icon}"></i>`; b.onclick = onclick; return b;
}

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
  const deskImg = deskC.querySelector("img"), mobImg = mobC.querySelector("img");
  const deskX = deskC.querySelector("button"), mobX = mobC.querySelector("button");

  wrap.dataset.desktop = ""; wrap.dataset.mobile = ""; wrap.dataset.moduleName = "";

  function promptForImage(cb) {
    const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById("pasteModal")); modal.show();
    const handler = (event) => {
      const items = (event.clipboardData || event.originalEvent?.clipboardData)?.items || [];
      for (let i=0;i<items.length;i++) {
        if (items[i].type.indexOf("image") !== -1) {
          const blob = items[i].getAsFile(); const r = new FileReader();
          r.onload = (e) => { cb(e.target.result); modal.hide(); };
          r.readAsDataURL(blob); document.removeEventListener("paste", handler); return;
        }
      }
      modal.hide(); document.removeEventListener("paste", handler); alert("No image found in clipboard.");
    };
    document.addEventListener("paste", handler);
  }

  btnDesktop.onclick = (e)=>{ e.stopPropagation(); promptForImage((b64)=>{ wrap.dataset.desktop=b64; deskImg.src=b64; deskImg.style.display="block"; deskX.style.display="block"; btnDesktop.innerText="Desktop Image Set";});};
  btnMobile.onclick  = (e)=>{ e.stopPropagation(); promptForImage((b64)=>{ wrap.dataset.mobile=b64; mobImg.src=b64; mobImg.style.display="block"; mobX.style.display="block"; btnMobile.innerText="Mobile Image Set";});};
  deskX.onclick = (e)=>{ e.stopPropagation(); wrap.dataset.desktop=""; deskImg.src=""; deskImg.style.display="none"; deskX.style.display="none"; btnDesktop.innerText="Set Desktop Image";};
  mobX.onclick  = (e)=>{ e.stopPropagation(); wrap.dataset.mobile="";  mobImg.src="";  mobImg.style.display="none";  mobX.style.display="none";  btnMobile.innerText="Set Mobile Image";};

  btnCreate.onclick = ()=> {
    const name = nameInput.value.trim() || "Insert Clipping";
    const desktop = wrap.dataset.desktop; let mobile = wrap.dataset.mobile;
    if (!desktop) { alert("Please provide at least a desktop image."); return; }
    if (!mobile) mobile = desktop;
    addModuleToCanvas("Custom", { desktop, mobile, customName: name, tags: [], isCustom: true });
  };

  return wrap;
}
