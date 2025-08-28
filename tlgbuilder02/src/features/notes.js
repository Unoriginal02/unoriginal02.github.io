// src/features/notes.js
import { state } from "../state/viewState.js";
import { el } from "../ui/domRefs.js";

export function initNotes() {
  state.quill = new Quill("#noteEditor", {
    theme: "snow",
    modules: { toolbar: [[{ header: [1,2,3,false] }], ["bold","italic","underline","strike"], [{ list:"ordered"},{ list:"bullet"}], ["link","image"]] },
  });
  document.getElementById("saveNoteBtn").addEventListener("click", saveNote);
  el.noteModal().addEventListener("hide.bs.modal", () => { state.currentlyEditingNoteBlock = null; });
}

export function addNoteIndicator(blockDiv) {
  if (blockDiv.querySelector(".note-indicator")) return;
  const indicator = document.createElement("div");
  indicator.classList.add("note-indicator");
  blockDiv.appendChild(indicator);
}

export function saveNote() {
  if (!state.currentlyEditingNoteBlock) return;
  const html = state.quill.root.innerHTML.trim();
  const block = state.currentlyEditingNoteBlock;
  block.dataset.note = html;
  const ind = block.querySelector(".note-indicator");
  if (html !== "" && !ind) addNoteIndicator(block);
  if (html === "" && ind) ind.remove();
  bootstrap.Modal.getOrCreateInstance(el.noteModal()).hide();
}
