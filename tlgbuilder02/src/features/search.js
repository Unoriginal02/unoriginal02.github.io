// src/features/search.js
import { state } from "../state/viewState.js";
import { el } from "../ui/domRefs.js";
import { categories } from "../data/categories.js";
import { addModuleToCanvas } from "../ui/modulesModal.js";

// --- simple fuzzy helpers ---
function norm(s){ return s.toLowerCase().trim(); }
function containsLike(q, s){ return norm(s).includes(norm(q)); }
function lev(a,b){ // Levenshtein distance
  a=norm(a); b=norm(b);
  const dp=Array(b.length+1).fill(0).map((_,i)=>[i]);
  for(let j=0;j<=a.length;j++) dp[0][j]=j;
  for(let i=1;i<=b.length;i++){
    for(let j=1;j<=a.length;j++){
      dp[i][j]=Math.min(
        dp[i-1][j]+1, dp[i][j-1]+1,
        dp[i-1][j-1]+(a[j-1]===b[i-1]?0:1)
      );
    }
  }
  return dp[b.length][a.length];
}
function score(query, target){
  if(!query) return 0;
  if(containsLike(query,target)) return 0; // best score
  const d = lev(query, target);
  return d / Math.max(query.length, target.length);
}

// build searchable list once per view mode
function buildIndex(){
  const list=[];
  categories.forEach(cat=>{
    (cat.files||[]).forEach(f=>{
      const file = state.viewMode==="mobile" ? f.mobile : f.desktop;
      const display = cat.category==="Spacers"
        ? `${state.viewMode==="mobile"?f.mobile:f.desktop}px Spacer`
        : (cat.category==="Custom" ? (f.customName||"Insert Clipping") : file.replace(".svg",""));
      const tags = f.tags || [];
      list.push({
        category: cat.category,
        fileObj: f,
        title: display,
        haystack: [display, cat.category, ...(tags)].join(" ").toLowerCase(),
        tags
      });
    });
  });
  return list;
}

let INDEX = [];

export function initModuleSearch(){
  INDEX = buildIndex();

  // rebuild index when mode toggles (caller should invoke again after viewMode changes)
  document.addEventListener("viewmode:changed", ()=>{ INDEX = buildIndex(); });

  const input = el.moduleSearch();
  const panel = el.moduleSearchResults();

  let t=null;
  input.addEventListener("input", ()=>{
    clearTimeout(t);
    t = setTimeout(()=> render(input.value, panel), 120);
  });

  input.addEventListener("keydown", (e)=>{
    if(e.key==="Escape"){ panel.style.display="none"; panel.innerHTML=""; input.blur(); }
  });

  document.addEventListener("click", (e)=>{
    if(!panel.contains(e.target) && e.target!==input){
      panel.style.display="none"; panel.innerHTML="";
    }
  });
}

function render(query, panel){
  const q = norm(query);
  if(!q){ panel.style.display="none"; panel.innerHTML=""; return; }

  let results = INDEX.filter(r=> r.haystack.includes(q));
  if(results.length===0){
    results = INDEX.map(r=>{
      const tokens = [r.title, r.category, ...(r.tags||[])];
      const best = Math.min(...tokens.map(t=>score(q,t)));
      return { ...r, fuzzy: best };
    }).filter(r=> r.fuzzy <= 0.5).sort((a,b)=> a.fuzzy - b.fuzzy).slice(0,20);
  } else {
    results = results.sort((a,b)=> a.title.length - b.title.length).slice(0,20);
  }
  if(results.length===0){ panel.style.display="none"; panel.innerHTML=""; return; }

  panel.innerHTML = results.map(r=>{
    const file = state.viewMode==="mobile" ? r.fileObj.mobile : r.fileObj.desktop;
    const title = r.category==="Spacers"
      ? `${state.viewMode==="mobile"?r.fileObj.mobile:r.fileObj.desktop}px Spacer`
      : (r.category==="Custom" ? (r.fileObj.customName||"Insert Clipping") : file.replace(".svg",""));

    const preview = r.category==="Spacers"
      ? `<div class="spacer-thumb" style="height:${state.viewMode==="mobile"?r.fileObj.mobile:r.fileObj.desktop}px"></div>`
      : `<img class="module-item-thumb module-image" src="${r.category==="Custom"?file:`Modules/${r.category}/${file}`}" alt="${title}">`;  /* same path as modal */  // :contentReference[oaicite:0]{index=0}

    const tags = (r.fileObj.tags?.length)
      ? `<div class="module-tags">${r.fileObj.tags.map(t=>`<span class="module-tag">${t}</span>`).join("")}</div>` // same classes as modal
      : "";  // :contentReference[oaicite:1]{index=1}

    return `
      <div class="search-item">
        <div class="search-thumb">${preview}</div>
        <div class="search-body">
          <div class="search-title">${title}</div>
          <div class="search-meta">${r.category}</div>
          ${tags}
        </div>
      </div>`;
  }).join("");

  // click to add
  [...panel.querySelectorAll(".search-item")].forEach((row, i)=>{
    row.addEventListener("click", ()=>{
      const r = results[i];
      addModuleToCanvas(r.category, r.fileObj);
      panel.style.display="none"; panel.innerHTML="";
      el.moduleSearch().value="";
    });
  });

  panel.style.display="block";
}
