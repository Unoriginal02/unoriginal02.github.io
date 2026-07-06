// src/ui/canvas.js
import { state } from "../state/viewState.js";
import { el } from "./domRefs.js";
import { replaceWithInlineSvg } from "./modulesModal.js"; // ← add this line

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
    } else if (category === "FreeForm") {
      // ← NUEVO: soporte Free Form al cambiar Desktop/Mobile
      const pad = parseInt(node.dataset.padding || "20", 10);
      const cols = parseInt(node.dataset.cols || "3", 10);
      const gap = parseInt(node.dataset.gap || "16", 10);
      const height = parseInt(node.dataset.height || "300", 10);

      node.style.width = state.viewMode === "desktop" ? "1500px" : "360px";
      node.style.display = "grid";
      node.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      node.style.gap = `${gap}px`;
      node.style.padding = `0 ${pad}px`; // solo padding horizontal
      node.style.height = `${height}px`;
      // node.style.backgroundColor = "#e5e5e5";
    } else if (category === "Custom") {
      node.src = state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop;
    } else {
      const file = state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop;
      const url = `Modules/${node.dataset.category}/${file}`;

      // If it’s already an SVG element, we simply re-inline the new one by swapping again.
      // If it’s still an <img>, the helper will replace it.
      replaceWithInlineSvg(node, url).catch(console.error);
    }

    // Actualización de la etiqueta visible
    const label = node.parentElement.querySelector(".module-name-label");
    if (label) {
      if (category === "Spacers") {
        label.innerText = `${state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop}px Spacer`;
      } else if (category === "FreeForm") {
        const cols = parseInt(node.dataset.cols || "3", 10);
        label.innerText = `${cols} cols`;
      } else if (category === "Custom") {
        label.innerText = (state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop) ? "" : node.dataset.moduleName;
      } else {
        label.innerText = (state.viewMode === "mobile" ? node.dataset.mobile : node.dataset.desktop).replace(".svg", "");
      }
    }

    if (category === "Spacers") node.style.border = "none";
  });
}
