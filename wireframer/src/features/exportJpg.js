// src/features/exportJpg.js
import { el } from "../ui/domRefs.js";
import { state } from "../state/viewState.js";

const LOGO_PATH = "assets/logo.svg"; // put your SVG at /assets/logo.svg

export function initExportJpg() {
  // Open modal on button click
  el.downloadBtn().addEventListener("click", () => {
    // default the date to today
    const today = new Date().toISOString().slice(0, 10);
    el.downloadDateInput().value = today;

    // try to guess a friendly default name
    el.downloadNameInput().value = el.downloadNameInput().value || "Wireframe";

    bootstrap.Modal.getOrCreateInstance(el.downloadModal()).show();
  });

  // Confirm & download
  el.confirmDownloadBtn().addEventListener("click", async () => {
    const name = (el.downloadNameInput().value || "Wireframe").trim();
    const dateStr = el.downloadDateInput().value || new Date().toISOString().slice(0,10);

    // Build an off-DOM export container (header + cloned canvas)
    const exportRoot = await buildExportRoot({ name, dateStr });

    // Render to canvas
    const canvas = await html2canvas(exportRoot, {
      backgroundColor: "#ffffff",
      scale: 1,           // crisper output
      useCORS: true       // allows external images if same-origin/CORS ok
    });

    // Convert to JPG & download
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const a = document.createElement("a");
    const safeName = name.replace(/[^\w\-]+/g, "_");
    a.href = dataUrl;
    a.download = `${safeName}__${dateStr}.jpg`;
    document.body.appendChild(a);
    a.click();
    a.remove();

    // Cleanup export DOM
    exportRoot.remove();
    bootstrap.Modal.getInstance(el.downloadModal()).hide();
  });
}

async function buildExportRoot({ name, dateStr }) {
  // 1) Root wrapper
  const root = document.createElement("div");
  root.className = "export-root";
  
  // 2) Header (black)
  const header = document.createElement("div");
  header.className = "export-header";

  // logo on the left
  const logo = document.createElement("img");
  logo.className = "export-logo";
  logo.src = LOGO_PATH;
  logo.alt = "Logo";

  // meta section on the right
  const meta = document.createElement("div");
  meta.className = "export-meta";

  // --- group 1: Proyecto ---
  const groupProject = document.createElement("div");
  groupProject.className = "meta-group";
  const nameLabel = document.createElement("span");
  nameLabel.className = "label";
  nameLabel.textContent = "Proyecto:";
  const nameSpan = document.createElement("span");
  nameSpan.className = "export-name";
  nameSpan.textContent = name;
  groupProject.appendChild(nameLabel);
  groupProject.appendChild(nameSpan);

  // --- group 2: Fecha ---
  const groupDate = document.createElement("div");
  groupDate.className = "meta-group";
  const dateLabel = document.createElement("span");
  dateLabel.className = "label";
  dateLabel.textContent = "Fecha:";
  const dateSpan = document.createElement("span");
  dateSpan.className = "export-date";
  dateSpan.textContent = dateStr;
  groupDate.appendChild(dateLabel);
  groupDate.appendChild(dateSpan);

    // --- group 3: View ---
  const groupView = document.createElement("div");
  groupView.className = "meta-group";
  const viewLabel = document.createElement("span");
  viewLabel.className = "label";
  viewLabel.textContent = "View:";
  const viewSpan = document.createElement("span");
  viewSpan.className = "export-view";
  viewSpan.textContent = (state.viewMode === "mobile") ? "Mobile" : "Desktop"; // <-- uses current mode
  groupView.appendChild(viewLabel);
  groupView.appendChild(viewSpan);

  // append all groups (Proyecto, Fecha, View)
  meta.appendChild(groupProject);
  meta.appendChild(groupDate);
  meta.appendChild(groupView);

  // append both groups
  meta.appendChild(groupProject);
  meta.appendChild(groupDate);
  header.appendChild(logo);
  header.appendChild(meta);

  // 3) Body = a deep clone of your #canvas
  const liveCanvas = el.canvas();
  const clone = liveCanvas.cloneNode(true);

  // Ensure the clone resolves image srcs for current viewMode
  // (Your updateAllModules() handles this in live view. For the clone,
  // current DOM already points to correct srcs based on state.viewMode.)
  // Also keep the max width consistent with current mode:
  clone.style.maxWidth = (state.viewMode === "desktop" ? "1500px" : "360px");
  clone.style.margin = "0 auto";
  clone.classList.remove("mt-3"); // optional: remove live-only margins if present

  const body = document.createElement("div");
  body.className = "export-body";
  body.appendChild(clone);

  // Put it all together
  root.appendChild(header);
  root.appendChild(body);

  // Attach offscreen so html2canvas can measure/layout
  Object.assign(root.style, {
    position: "fixed",
    left: "-10000px",
    top: "0"
  });
  document.body.appendChild(root);

  return root;
}
