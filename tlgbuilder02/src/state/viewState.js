// src/state/viewState.js
export const state = {
  viewMode: "desktop",              // "desktop" | "mobile"
  currentlySwappingBlock: null,     // HTMLElement | null
  currentlyInsertingBlockAfter: null,
  currentlyEditingNoteBlock: null,
  quill: null,
};
