// src/main.js
import { state } from "./state/viewState.js";
import { el } from "./ui/domRefs.js";
import { initModulesModal, populateModulesModal } from "./ui/modulesModal.js";
import { updateAllModules } from "./ui/canvas.js";
import { initNotes } from "./features/notes.js";
import { initExportImport } from "./features/exportImport.js";
import { initSortable } from "./features/sortable.js";
import { initModuleSearch } from "./features/search.js";

document.addEventListener("DOMContentLoaded", () => {
  // Mode toggle
  const labels = document.querySelectorAll('label[for="modeToggle"]');
  const desktopLabel = labels[0], mobileLabel = labels[1];
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

  // Populate modules when modal opens
  document.getElementById("modulesModal").addEventListener("show.bs.modal", () => populateModulesModal());
});
