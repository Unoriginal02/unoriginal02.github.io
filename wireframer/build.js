const fs = require("fs");
const path = require("path");

const root = __dirname;
const srcDir = path.join(root, "src");

const order = [
  "state/viewState.js",
  "ui/domRefs.js",
  "data/categories.js",
  "ui/canvas.js",
  "features/notes.js",
  "ui/modulesModal.js",
  "features/exportImport.js",
  "features/search.js",
  "features/sortable.js",
  "main.js"
];

function stripModuleSyntax(js) {
  return js
    .replace(/^\s*import\s+[^;]+;\s*$/gm, "")
    .replace(/^\s*export\s+(function|const|let|class)\s/gm, "$1 ")
    .replace(/^\s*export\s*\{[^}]+\};\s*$/gm, "");
}

function buildBundle() {
  let bundle = "// Auto-generated bundle (no ES modules)\n";
  for (const rel of order) {
    const abs = path.join(srcDir, rel);
    if (!fs.existsSync(abs)) {
      throw new Error(`Falta el archivo: src/${rel}`);
    }
    const code = fs.readFileSync(abs, "utf-8");
    bundle += `\n/* ===== ${rel} ===== */\n` + stripModuleSyntax(code) + "\n";
  }
  fs.writeFileSync(path.join(root, "bundle.local.js"), bundle, "utf-8");
  console.log("✅ bundle.local.js generado");
}

function buildLocalHtml() {
  const indexPath = path.join(root, "index.html");
  const outPath = path.join(root, "index_local.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error("No se encontró index.html en la raíz del proyecto");
  }

  let html = fs.readFileSync(indexPath, "utf-8");

  // 1) Ajustar CSS local si fuera necesario
  html = html.replace('href="css/style.css"', 'href="./css/style.css"');

  // 2) Reemplazar el script type="module" por el bundle clásico
  const moduleScriptRegex = /<script\s+type=["']module["']\s+src=["']src\/main\.js["']><\/script>/i;
  if (moduleScriptRegex.test(html)) {
    html = html.replace(
      moduleScriptRegex,
      '<script src="bundle.local.js"></script>'
    );
  } else {
    // Si no hay tag module esperado, insertamos el bundle antes del cierre del body
    html = html.replace(
      /<\/body>/i,
      '  <script src="bundle.local.js"></script>\n</body>'
    );
  }

  fs.writeFileSync(outPath, html, "utf-8");
  console.log("✅ index_local.html generado");
}

try {
  buildBundle();
  buildLocalHtml();
  console.log("🎉 Build completado (bundle + HTML local). Abre index_local.html con doble clic.");
} catch (err) {
  console.error("❌ Error en build:", err.message);
  process.exit(1);
}
