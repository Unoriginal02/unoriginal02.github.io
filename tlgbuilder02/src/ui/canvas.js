// src/ui/canvas.js
import { state } from "../state/viewState.js";
import { el } from "./domRefs.js";

export function updateAllModules() {
  const all = el.canvas().querySelectorAll(".block-container > :first-child");
  all.forEach((node) => {
    const category = node.dataset.category;
    if (category === "Spacers") {
      const h = state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop;
      Object.assign(node.style, {
        height: h + "px",
        backgroundColor: "#ffffff",
        width: state.viewMode === "desktop" ? "1500px" : "360px",
      });
    } else if (category === "Custom") {
      node.src = state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop;
    } else {
      const file = state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop;
      node.src = `Modules/${node.dataset.category}/${file}`;
    }
    const label = node.parentElement.querySelector(".module-name-label");
    if (label) {
      if (category === "Spacers") {
        label.innerText = `${state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop}px Spacer`;
      } else if (category === "Custom") {
        label.innerText = (state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop) ? "" : node.dataset.moduleName;
      } else {
        label.innerText = (state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop).replace(".svg", "");
      }
    }
    if (category === "Spacers") node.style.border = "none";
  });
}
