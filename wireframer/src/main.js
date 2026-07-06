// src/main.js
import { state } from "./state/viewState.js";
import { el } from "./ui/domRefs.js";
import { initModulesModal, populateModulesModal } from "./ui/modulesModal.js";
import { updateAllModules } from "./ui/canvas.js";
import { initNotes } from "./features/notes.js";
import { initExportImport } from "./features/exportImport.js";
import { initSortable } from "./features/sortable.js";
import { initModuleSearch } from "./features/search.js";
import { setIdeaMessage } from "./ui/modulesModal.js";
import { initExportJpg } from "./features/exportJpg.js"
import { initPreviewMode } from "./features/previewMode.js";

document.addEventListener("DOMContentLoaded", () => {
  // Mode toggle
  const labels = document.querySelectorAll('label[for="modeToggle"]');
  const desktopLabel = labels[0],
    mobileLabel = labels[1];
  el.modeToggle().checked = false;
  desktopLabel.style.fontWeight = "bold";
  el.modeToggle().addEventListener("change", () => {
    state.viewMode = el.modeToggle().checked ? "mobile" : "desktop";
    desktopLabel.style.fontWeight = state.viewMode === "desktop" ? "bold" : "normal";
    mobileLabel.style.fontWeight = state.viewMode === "mobile" ? "bold" : "normal";
    el.canvas().style.maxWidth = state.viewMode === "desktop" ? "1500px" : "360px";
    updateAllModules();
    document.dispatchEvent(new Event("viewmode:changed"));
  });

  initModuleSearch();

  // Buttons
  initExportImport();
  el.addBlockBtn().addEventListener("click", () => {
    state.currentlySwappingBlock = null;
    state.currentlyInsertingBlockAfter = null;
  });

  // Modals and features
  initModulesModal();
  initNotes();
  initSortable();
  initExportJpg();
  initPreviewMode();

  function commitIdea() {
    const block = state.currentlyEditingIdeaBlock;
    if (!block) return;
    const val = el.ideaInput().value.trim();
    block.dataset.idea = val;
    setIdeaMessage(block, val);
    bootstrap.Modal.getOrCreateInstance(el.ideaModal()).hide();
    state.currentlyEditingIdeaBlock = null;
  }

  // Guardar "idea"
  el.saveIdeaBtn().addEventListener("click", commitIdea);

  // Borrar "idea"
  document.getElementById("clearIdeaBtn").addEventListener("click", () => {
    const block = state.currentlyEditingIdeaBlock;
    if (!block) return;
    block.dataset.idea = "";
    el.ideaInput().value = "";
    setIdeaMessage(block, "");
    // puedes mantener abierto el modal si prefieres; ahora lo cerramos:
    bootstrap.Modal.getOrCreateInstance(el.ideaModal()).hide();
    state.currentlyEditingIdeaBlock = null;
  });

  // Auto-focus input when idea modal opens
  el.ideaModal().addEventListener("shown.bs.modal", () => {
    const input = el.ideaInput();
    input.focus();
    // Opcional: selecciona el texto existente para edición rápida
    input.select();
  });

  // Ctrl+Enter (or Cmd+Enter on macOS) -> enviar
  el.ideaInput().addEventListener("keydown", (e) => {
    const isSubmitCombo = e.key === "Enter" && (e.ctrlKey || e.metaKey);
    if (isSubmitCombo) {
      e.preventDefault();
      commitIdea();
    }
  });

  // Populate modules when modal opens
  document.getElementById("modulesModal").addEventListener("show.bs.modal", () => populateModulesModal());
});
