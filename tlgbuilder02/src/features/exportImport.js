// src/features/exportImport.js
import { el } from "../ui/domRefs.js";
import { createModuleBlock } from "../ui/modulesModal.js";
import { addNoteIndicator } from "./notes.js";

export function initExportImport() {
  el.exportBtn().addEventListener("click", exportMockup);
  el.importBtn().addEventListener("click", () => el.importFileInput().click());
  el.importFileInput().addEventListener("change", importMockup);
  document.getElementById("getListBtn").addEventListener("click", getModuleList);
}

export function exportMockup() {
  const modules = Array.from(document.querySelectorAll("#canvas .block-container")).map((block) => {
    const elc = block.querySelector(":first-child");
    return { category: elc.dataset.category, desktop: elc.dataset.desktop, mobile: elc.dataset.mobile, note: block.dataset.note };
  });
  const blob = new Blob([JSON.stringify(modules, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: "mockup.json" });
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export function importMockup(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    try {
      const modules = JSON.parse(ev.target.result);
      const canvas = document.getElementById("canvas");
      canvas.innerHTML = "";
      modules.forEach(({ category, desktop, mobile, note }) => {
        const block = createModuleBlock(category, { desktop, mobile });
        if (note && note.trim() !== "") { block.dataset.note = note; addNoteIndicator(block); }
        canvas.appendChild(block);
      });
    } catch (err) { alert("Error loading mockup: " + err); }
  };
  reader.readAsText(file);
  e.target.value = "";
}

export function getModuleList() {
  const list = Array.from(document.querySelectorAll("#canvas .block-container")).map((block) => {
    const elc = block.querySelector(":first-child");
    const category = elc.dataset.category;
    let name = elc.dataset.desktop;
    if (category === "Spacers") name = (elc.dataset.mobile) + "px Spacer";
    else if (category === "Custom") name = elc.dataset.moduleName;
    else name = (elc.dataset.desktop).replace(".svg", "");
    return { name, note: block.dataset.note.trim() };
  });
  const html = list.map(m => `<div class="module-entry"><div class="module-name">${m.name}</div>${m.note ? `<div class="module-note ql-editor">${m.note}</div>`:""}</div>`).join("");
  el.moduleListContainer().innerHTML = html;
  bootstrap.Modal.getOrCreateInstance(document.getElementById("listModal")).show();
}
