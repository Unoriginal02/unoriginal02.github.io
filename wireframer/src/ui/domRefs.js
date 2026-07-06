// src/ui/domRefs.js
export const el = {
  canvas: () => document.getElementById("canvas"),
  modulesModal: () => document.getElementById("modulesModal"),
  noteModal: () => document.getElementById("noteModal"),
  pasteModal: () => document.getElementById("pasteModal"),
  exportBtn: () => document.getElementById("exportBtn"),
  importBtn: () => document.getElementById("importBtn"),
  importFileInput: () => document.getElementById("importFileInput"),
  getListBtn: () => document.getElementById("getListBtn"),
  addBlockBtn: () => document.getElementById("addBlockBtn"),
  modeToggle: () => document.getElementById("modeToggle"),
  clearBtn: () => document.getElementById("clearBtn"),

  // NEW: category-first UX
  categoryGrid: () => document.getElementById("categoryGrid"),
  categoryView: () => document.getElementById("categoryView"),
  backToGridBtn: () => document.getElementById("backToGridBtn"),
  selectedCategoryIcon: () => document.getElementById("selectedCategoryIcon"),
  selectedCategoryTitle: () => document.getElementById("selectedCategoryTitle"),
  categoryModulesList: () => document.getElementById("categoryModulesList"),

  // Existing search / notes / lists
  moduleListContainer: () => document.getElementById("moduleListContainer"),
  noteEditor: () => document.getElementById("noteEditor"),
  moduleSearch: () => document.getElementById("moduleSearch"),
  moduleSearchResults: () => document.getElementById("moduleSearchResults"),

  ideaModal: () => document.getElementById("ideaModal"),
  ideaInput: () => document.getElementById("ideaInput"),
  saveIdeaBtn: () => document.getElementById("saveIdeaBtn"),

  // Download → JPG
  downloadBtn: () => document.getElementById("downloadJpgBtn"),
  downloadModal: () => document.getElementById("downloadModal"),
  downloadNameInput: () => document.getElementById("downloadName"),
  downloadDateInput: () => document.getElementById("downloadDate"),
  confirmDownloadBtn: () => document.getElementById("confirmDownloadBtn"),
};
