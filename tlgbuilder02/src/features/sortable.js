// src/features/sortable.js
export function initSortable() {
  Sortable.create(document.getElementById("canvas"), { animation: 150, ghostClass: "sortable-ghost" });
}
