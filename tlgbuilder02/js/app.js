// Global variables
let currentlySwappingBlock = null; // For swapping an existing block
let currentlyInsertingBlockAfter = null; // For inserting a block after a hovered block
let viewMode = "desktop"; // global state: "desktop" or "mobile"
let currentlyEditingNoteBlock = null; // block currently being edited for notes
let quillEditor = null; // Global variable for the Quill editor instance

// Wait until DOM is fully loaded
document.addEventListener("DOMContentLoaded", () => {
  setupViewToggle();

  // Export/Import/Get List button event listeners
  document.getElementById("exportBtn").addEventListener("click", exportMockup);
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFileInput").click();
  });
  document.getElementById("importFileInput").addEventListener("change", importMockup);
  document.getElementById("getListBtn").addEventListener("click", getModuleList);

  // Add block at bottom button
  document.getElementById("addBlockBtn").addEventListener("click", () => {
    currentlySwappingBlock = null;
    currentlyInsertingBlockAfter = null;
  });

  // When modules modal is about to be shown, re-populate it based on current view mode.
  const modulesModalEl = document.getElementById("modulesModal");
  modulesModalEl.addEventListener("show.bs.modal", () => {
    populateModulesModal(categories);
  });

  // Note Modal event listeners
  document.getElementById("saveNoteBtn").addEventListener("click", saveNote);
  const noteModalEl = document.getElementById("noteModal");
  noteModalEl.addEventListener("hide.bs.modal", () => {
    currentlyEditingNoteBlock = null;
  });

  // Initialize Sortable.js on the canvas
  initializeSortable();

  // Initialize Quill rich text editor for the note modal with updated toolbar (no quotations and code blocks)
  quillEditor = new Quill("#noteEditor", {
    theme: "snow",
    modules: {
      toolbar: [
        [{ header: [1, 2, 3, false] }],
        ["bold", "italic", "underline", "strike"],
        [{ list: "ordered" }, { list: "bullet" }],
        ["link", "image"],
      ],
    },
  });
});

// Helper function to prompt the user to paste an image and capture its base64
function promptForImage(callback) {
  // Show the custom paste modal instead of a blocking alert.
  const pasteModalEl = document.getElementById("pasteModal");
  const pasteModal = bootstrap.Modal.getOrCreateInstance(pasteModalEl);
  pasteModal.show();

  const handler = (event) => {
    const items = (event.clipboardData || event.originalEvent.clipboardData).items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const blob = items[i].getAsFile();
        const reader = new FileReader();
        reader.onload = function (evt) {
          callback(evt.target.result);
          pasteModal.hide();
        };
        reader.readAsDataURL(blob);
        document.removeEventListener("paste", handler);
        return;
      }
    }
    pasteModal.hide();
    document.removeEventListener("paste", handler);
    alert("No image found in clipboard.");
  };

  document.addEventListener("paste", handler);
}

function setupViewToggle() {
  const modeToggle = document.getElementById("modeToggle");
  const labels = document.querySelectorAll('label[for="modeToggle"]');
  const desktopLabel = labels[0];
  const mobileLabel = labels[1];

  // Set initial labels based on default viewMode
  if (viewMode === "desktop") {
    modeToggle.checked = false;
    desktopLabel.style.fontWeight = "bold";
    mobileLabel.style.fontWeight = "normal";
  } else {
    modeToggle.checked = true;
    desktopLabel.style.fontWeight = "normal";
    mobileLabel.style.fontWeight = "bold";
  }

  modeToggle.addEventListener("change", () => {
    if (modeToggle.checked) {
      viewMode = "mobile";
      desktopLabel.style.fontWeight = "normal";
      mobileLabel.style.fontWeight = "bold";
    } else {
      viewMode = "desktop";
      desktopLabel.style.fontWeight = "bold";
      mobileLabel.style.fontWeight = "normal";
    }
    // Update canvas max width based on mode
    const canvas = document.getElementById("canvas");
    canvas.style.maxWidth = viewMode === "desktop" ? "1500px" : "360px";
    updateAllModules();
  });
}

function updateAllModules() {
  const allModuleElements = document.querySelectorAll("#canvas .block-container > :first-child");
  allModuleElements.forEach((el) => {
    const category = el.dataset.category;
    if (category === "Spacers") {
      const newHeight = viewMode === "mobile" ? el.dataset.mobile : el.dataset.desktop;
      el.style.height = newHeight + "px";
      el.style.backgroundColor = "#ffffff";
      // Set fixed width for spacers based on view mode
      el.style.width = viewMode === "desktop" ? "1500px" : "360px";
    } else if (category === "Custom") {
      // For custom modules, update src based on view mode
      const newFile = viewMode === "mobile" ? el.dataset.mobile : el.dataset.desktop;
      el.src = newFile;
    } else {
      const newFile = viewMode === "mobile" ? el.dataset.mobile : el.dataset.desktop;
      el.src = `Modules/${category}/${newFile}`;
    }
    // Update the module name label in the overlay.
    const blockDiv = el.parentElement;
    const overlayDiv = blockDiv.querySelector(".module-overlay");
    if (overlayDiv) {
      const moduleNameLabel = overlayDiv.querySelector(".module-name-label");
      if (category === "Spacers") {
        moduleNameLabel.innerText = `${viewMode === "mobile" ? el.dataset.mobile : el.dataset.desktop}px Spacer`;
      } else if (category === "Custom") {
        moduleNameLabel.innerText = (viewMode === "mobile" ? el.dataset.mobile : el.dataset.desktop)
          ? ""
          : el.dataset.moduleName;
      } else {
        moduleNameLabel.innerText = (viewMode === "mobile" ? el.dataset.mobile : el.dataset.desktop).replace(".svg", "");
      }
    }
    if (category === "Spacers") {
      el.style.border = "none";
    }
  });
  // Update modules in the modal if it is open.
  const modulesModalEl = document.getElementById("modulesModal");
  const modalInstance = bootstrap.Modal.getInstance(modulesModalEl);
  if (modalInstance && modulesModalEl.classList.contains("show")) {
    populateModulesModal(categories);
  }
}

function populateModulesModal(categories) {
  const tabList = document.getElementById("modulesTab");
  const tabContent = document.getElementById("modulesTabContent");
  tabList.innerHTML = "";
  tabContent.innerHTML = "";

  categories.forEach((catObj, index) => {
    const { category, files } = catObj;

    // Create nav item
    const navItem = document.createElement("li");
    navItem.classList.add("nav-item");
    navItem.setAttribute("role", "presentation");

    const navLink = document.createElement("button");
    navLink.classList.add("nav-link");
    navLink.id = `tab-${index}`;
    navLink.setAttribute("data-bs-toggle", "pill");
    navLink.setAttribute("data-bs-target", `#pill-${index}`);
    navLink.setAttribute("type", "button");
    navLink.setAttribute("role", "tab");
    navLink.setAttribute("aria-controls", `pill-${index}`);
    navLink.setAttribute("aria-selected", index === 0 ? "true" : "false");
    navLink.innerText = category;

    navItem.appendChild(navLink);
    tabList.appendChild(navItem);

    // Create tab pane
    const tabPane = document.createElement("div");
    tabPane.classList.add("tab-pane", "fade");
    tabPane.id = `pill-${index}`;
    tabPane.setAttribute("role", "tabpanel");
    tabPane.setAttribute("aria-labelledby", `tab-${index}`);

    if (category === "Custom") {
      // The main container for the custom module
      const moduleContainer = document.createElement("div");
      moduleContainer.classList.add("module-item-container", "custom-insert");

      // 1) Big title: "Insert clipping"
      const mainTitle = document.createElement("div");
      mainTitle.classList.add("module-title");
      mainTitle.innerText = "Insert clipping";
      moduleContainer.appendChild(mainTitle);

      // 2) Row #1 => Label + Input for "Module name" above input, then the 3 buttons
      const row1 = document.createElement("div");
      row1.classList.add("custom-insert-row1");

      // Left: label + wide input
      const nameFieldGroup = document.createElement("div");
      nameFieldGroup.classList.add("custom-field-group");
      const nameLabel = document.createElement("label");
      nameLabel.innerText = "Module name";
      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "Enter module name";

      nameFieldGroup.appendChild(nameLabel);
      nameFieldGroup.appendChild(nameInput);

      // Desktop Image Button
      const desktopBtnContainer = document.createElement("div");
      desktopBtnContainer.classList.add("custom-btn-container");
      const btnDesktop = document.createElement("button");
      btnDesktop.classList.add("btn", "btn-outline-primary");
      btnDesktop.innerText = "Set Desktop Image";
      desktopBtnContainer.appendChild(btnDesktop);

      // Mobile Image Button
      const mobileBtnContainer = document.createElement("div");
      mobileBtnContainer.classList.add("custom-btn-container");
      const btnMobile = document.createElement("button");
      btnMobile.classList.add("btn", "btn-outline-primary");
      btnMobile.innerText = "Set Mobile Image";
      mobileBtnContainer.appendChild(btnMobile);

      // Create Button
      const createBtnContainer = document.createElement("div");
      createBtnContainer.classList.add("custom-btn-container");
      const addCustomBtn = document.createElement("button");
      addCustomBtn.classList.add("btn", "btn-primary");
      addCustomBtn.innerText = "Create";
      createBtnContainer.appendChild(addCustomBtn);

      // Append them to row1
      row1.appendChild(nameFieldGroup);
      row1.appendChild(desktopBtnContainer);
      row1.appendChild(mobileBtnContainer);
      row1.appendChild(createBtnContainer);

      moduleContainer.appendChild(row1);

      // 3) Row #2 => preview images with clear (✕) button
      const row2 = document.createElement("div");
      row2.classList.add("custom-insert-row2");

      // Desktop preview container
      const desktopPreviewContainer = document.createElement("div");
      desktopPreviewContainer.classList.add("custom-preview-container");
      const desktopPreview = document.createElement("img");
      desktopPreview.classList.add("image-preview");
      desktopPreview.style.display = "none"; // hidden until an image is set
      desktopPreviewContainer.appendChild(desktopPreview);

      const clearDesktopBtn = document.createElement("button");
      clearDesktopBtn.classList.add("clear-preview-btn");
      clearDesktopBtn.innerText = "✕";
      clearDesktopBtn.style.display = "none";
      desktopPreviewContainer.appendChild(clearDesktopBtn);

      // Mobile preview container
      const mobilePreviewContainer = document.createElement("div");
      mobilePreviewContainer.classList.add("custom-preview-container");
      const mobilePreview = document.createElement("img");
      mobilePreview.classList.add("image-preview");
      mobilePreview.style.display = "none";
      mobilePreviewContainer.appendChild(mobilePreview);

      const clearMobileBtn = document.createElement("button");
      clearMobileBtn.classList.add("clear-preview-btn");
      clearMobileBtn.innerText = "✕";
      clearMobileBtn.style.display = "none";
      mobilePreviewContainer.appendChild(clearMobileBtn);

      // Append preview containers to row2
      row2.appendChild(desktopPreviewContainer);
      row2.appendChild(mobilePreviewContainer);
      moduleContainer.appendChild(row2);

      // Save image data in the container's dataset
      moduleContainer.dataset.desktop = "";
      moduleContainer.dataset.mobile = "";
      moduleContainer.dataset.moduleName = "";

      // Desktop image button logic
      btnDesktop.addEventListener("click", (e) => {
        e.stopPropagation();
        promptForImage((base64) => {
          moduleContainer.dataset.desktop = base64;
          desktopPreview.src = base64;
          desktopPreview.style.display = "block";
          clearDesktopBtn.style.display = "block";
          btnDesktop.innerText = "Desktop Image Set";
        });
      });

      // Mobile image button logic
      btnMobile.addEventListener("click", (e) => {
        e.stopPropagation();
        promptForImage((base64) => {
          moduleContainer.dataset.mobile = base64;
          mobilePreview.src = base64;
          mobilePreview.style.display = "block";
          clearMobileBtn.style.display = "block";
          btnMobile.innerText = "Mobile Image Set";
        });
      });

      // Clear preview logic
      clearDesktopBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        moduleContainer.dataset.desktop = "";
        desktopPreview.src = "";
        desktopPreview.style.display = "none";
        clearDesktopBtn.style.display = "none";
        btnDesktop.innerText = "Set Desktop Image";
      });
      clearMobileBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        moduleContainer.dataset.mobile = "";
        mobilePreview.src = "";
        mobilePreview.style.display = "none";
        clearMobileBtn.style.display = "none";
        btnMobile.innerText = "Set Mobile Image";
      });

      // Create button logic
      addCustomBtn.addEventListener("click", () => {
        const moduleName = nameInput.value.trim() || "Insert Clipping";
        const desktopImage = moduleContainer.dataset.desktop;
        let mobileImage = moduleContainer.dataset.mobile;
        if (!desktopImage) {
          alert("Please provide at least a desktop image.");
          return;
        }
        if (!mobileImage) mobileImage = desktopImage;
        // Construct a custom file object with the provided data
        const customFileObj = {
          desktop: desktopImage,
          mobile: mobileImage,
          customName: moduleName,
          tags: [],
          isCustom: true,
        };
        addModuleToCanvas("Custom", customFileObj);
      });

      tabPane.appendChild(moduleContainer);
    } else {
      // For normal categories, iterate over the files array.
      files.forEach((fileObj) => {
        const moduleContainer = document.createElement("div");
        moduleContainer.classList.add("module-item-container");
        if (viewMode === "mobile") moduleContainer.classList.add("mobile-mode");

        // Module Title
        const titleDiv = document.createElement("div");
        titleDiv.classList.add("module-title");
        if (category === "Spacers") {
          titleDiv.innerText = `${viewMode === "mobile" ? fileObj.mobile : fileObj.desktop}px Spacer`;
        } else {
          const fileName = viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
          titleDiv.innerText = fileName.replace(".svg", "");
        }
        moduleContainer.appendChild(titleDiv);

        // Module Image or Spacer Preview
        let fileContent;
        if (category === "Spacers") {
          const height = viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
          fileContent = document.createElement("div");
          fileContent.style.height = height + "px";
          fileContent.style.background = "#d3d3d3";
          fileContent.style.width = viewMode === "desktop" ? "1500px" : "360px";
        } else {
          const fileName = viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
          fileContent = document.createElement("img");
          fileContent.src = `Modules/${category}/${fileName}`;
          fileContent.alt = fileName;
          fileContent.classList.add("img-fluid", "module-item-thumb", "module-image");
          fileContent.style.cursor = "pointer";
          fileContent.style.width = "auto";
          fileContent.style.height = "auto";
        }
        moduleContainer.appendChild(fileContent);

        // Module Tags
        if (fileObj.tags && fileObj.tags.length > 0) {
          const tagsContainer = document.createElement("div");
          tagsContainer.classList.add("module-tags");
          fileObj.tags.forEach((tag) => {
            const tagSpan = document.createElement("span");
            tagSpan.classList.add("module-tag");
            tagSpan.innerText = tag;
            tagsContainer.appendChild(tagSpan);
          });
          moduleContainer.appendChild(tagsContainer);
        }

        // Module item click logic
        moduleContainer.onclick = () => {
          if (currentlySwappingBlock) {
            updateBlockSrc(currentlySwappingBlock, category, fileObj);
          } else if (currentlyInsertingBlockAfter) {
            addModuleAfter(currentlyInsertingBlockAfter, category, fileObj);
          } else {
            addModuleToCanvas(category, fileObj);
          }
        };

        tabPane.appendChild(moduleContainer);
      });
    }
    tabContent.appendChild(tabPane);
  });
}

function addModuleToCanvas(category, fileObj) {
  const canvas = document.getElementById("canvas");
  const newBlock = createModuleBlock(category, fileObj);
  canvas.appendChild(newBlock);
  closeModal();
}

function addModuleAfter(referenceBlock, category, fileObj) {
  const newBlock = createModuleBlock(category, fileObj);
  referenceBlock.insertAdjacentElement("afterend", newBlock);
  closeModal();
  currentlyInsertingBlockAfter = null;
}

function createModuleBlock(category, fileObj) {
  const blockDiv = document.createElement("div");
  blockDiv.classList.add("block-container");
  if (category === "Spacers") blockDiv.classList.add("spacer-block");

  let contentElement;
  let moduleName = "";
  if (category === "Spacers") {
    const height = viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    moduleName = `${height}px Spacer`;
    contentElement = document.createElement("div");
    contentElement.style.height = height + "px";
    contentElement.style.background = "#ffffff";
    contentElement.style.width = viewMode === "desktop" ? "1500px" : "360px";
  } else if (category === "Custom") {
    // Create an image element for the custom module using base64 data
    const fileName = fileObj.customName;
    moduleName = fileName;
    contentElement = document.createElement("img");
    contentElement.src = viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    contentElement.alt = fileName;
    contentElement.classList.add("module-image");
    contentElement.style.display = "block";
    contentElement.style.margin = "0";
    contentElement.style.maxWidth = "100%";
    contentElement.style.height = "auto";
  } else {
    const fileName = viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    moduleName = fileName.replace(".svg", "");
    contentElement = document.createElement("img");
    contentElement.src = `Modules/${category}/${fileName}`;
    contentElement.alt = fileName;
    contentElement.classList.add("module-image");
    contentElement.style.display = "block";
    contentElement.style.margin = "0";
    contentElement.style.maxWidth = "100%";
    contentElement.style.height = "auto";
  }

  // Save extra info for toggling later
  contentElement.dataset.category = category;
  contentElement.dataset.desktop = fileObj.desktop;
  contentElement.dataset.mobile = fileObj.mobile;
  if (category === "Custom") {
    contentElement.dataset.moduleName = fileObj.customName;
  }
  // Initialize note data attribute on the block
  blockDiv.dataset.note = "";

  blockDiv.appendChild(contentElement);

  // Create overlay
  const overlayDiv = document.createElement("div");
  overlayDiv.classList.add("module-overlay");

  // Module name label
  const moduleNameLabel = document.createElement("div");
  moduleNameLabel.classList.add("module-name-label");
  moduleNameLabel.innerText = moduleName;
  overlayDiv.appendChild(moduleNameLabel);

  // Overlay icons container
  const overlayIcons = document.createElement("div");
  overlayIcons.classList.add("overlay-icons");

  // Delete button
  const deleteBtn = document.createElement("button");
  deleteBtn.classList.add("icon-btn");
  deleteBtn.innerHTML = '<i class="bi bi-x-circle-fill"></i>';
  deleteBtn.title = "Delete";
  deleteBtn.onclick = (e) => {
    e.stopPropagation();
    blockDiv.remove();
  };

  // Swap button
  const swapBtn = document.createElement("button");
  swapBtn.classList.add("icon-btn");
  swapBtn.innerHTML = '<i class="bi bi-arrow-repeat"></i>';
  swapBtn.title = "Swap Module";
  swapBtn.onclick = (e) => {
    e.stopPropagation();
    currentlySwappingBlock = contentElement;
    const modulesModalEl = document.getElementById("modulesModal");
    const modal = bootstrap.Modal.getOrCreateInstance(modulesModalEl);
    modal.show();
  };

  // Clone button
  const cloneBtn = document.createElement("button");
  cloneBtn.classList.add("icon-btn");
  cloneBtn.innerHTML = '<i class="bi bi-files"></i>';
  cloneBtn.title = "Clone Module";
  cloneBtn.onclick = (e) => {
    e.stopPropagation();
    cloneBlock(blockDiv);
  };

  // Add-after button
  const addAfterBtn = document.createElement("button");
  addAfterBtn.classList.add("icon-btn");
  addAfterBtn.innerHTML = '<i class="bi bi-plus-circle"></i>';
  addAfterBtn.title = "Add Module After";
  addAfterBtn.onclick = (e) => {
    e.stopPropagation();
    currentlyInsertingBlockAfter = blockDiv;
    const modulesModalEl = document.getElementById("modulesModal");
    const modal = bootstrap.Modal.getOrCreateInstance(modulesModalEl);
    modal.show();
  };

  // Comment (Note) button
  const commentBtn = document.createElement("button");
  commentBtn.classList.add("icon-btn");
  commentBtn.innerHTML = '<i class="bi bi-chat-dots"></i>';
  commentBtn.title = "Add/View Note";
  commentBtn.onclick = (e) => {
    e.stopPropagation();
    currentlyEditingNoteBlock = blockDiv;
    quillEditor.root.innerHTML = blockDiv.dataset.note;
    const noteModalEl = document.getElementById("noteModal");
    const modal = bootstrap.Modal.getOrCreateInstance(noteModalEl);
    modal.show();
  };

  // Assemble overlay icons
  overlayIcons.appendChild(deleteBtn);
  overlayIcons.appendChild(swapBtn);
  overlayIcons.appendChild(cloneBtn);
  overlayIcons.appendChild(addAfterBtn);
  overlayIcons.appendChild(commentBtn);
  overlayDiv.appendChild(overlayIcons);

  blockDiv.appendChild(overlayDiv);

  // If block has a note, add note indicator
  if (blockDiv.dataset.note.trim() !== "") {
    addNoteIndicator(blockDiv);
  }

  return blockDiv;
}

function updateBlockSrc(contentElement, category, fileObj) {
  if (category === "Spacers") {
    const height = viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    contentElement.style.height = height + "px";
    contentElement.style.background = "#ffffff";
    contentElement.style.width = viewMode === "desktop" ? "1500px" : "360px";
    contentElement.dataset.desktop = fileObj.desktop;
    contentElement.dataset.mobile = fileObj.mobile;
    const overlayDiv = contentElement.parentElement.querySelector(".module-overlay");
    if (overlayDiv) {
      const moduleNameLabel = overlayDiv.querySelector(".module-name-label");
      moduleNameLabel.innerText = `${height}px Spacer`;
    }
  } else {
    const fileName = viewMode === "mobile" ? fileObj.mobile : fileObj.desktop;
    contentElement.src = category === "Custom" ? fileObj.desktop : `Modules/${category}/${fileName}`;
    contentElement.dataset.desktop = fileObj.desktop;
    contentElement.dataset.mobile = fileObj.mobile;
    const overlayDiv = contentElement.parentElement.querySelector(".module-overlay");
    if (overlayDiv) {
      const moduleNameLabel = overlayDiv.querySelector(".module-name-label");
      moduleNameLabel.innerText = category === "Custom" ? fileObj.customName : fileName.replace(".svg", "");
    }
  }
  closeModal();
  currentlySwappingBlock = null;
}

function closeModal() {
  const modulesModalEl = document.getElementById("modulesModal");
  const modal = bootstrap.Modal.getInstance(modulesModalEl);
  if (modal) modal.hide();
}

function cloneBlock(blockDiv) {
  const newBlockDiv = blockDiv.cloneNode(true);
  newBlockDiv.style.opacity = "1";

  const overlayButtons = newBlockDiv.querySelectorAll(".icon-btn");
  const newDeleteBtn = overlayButtons[0],
    newSwapBtn = overlayButtons[1],
    newCloneBtn = overlayButtons[2],
    newAddAfterBtn = overlayButtons[3],
    newCommentBtn = overlayButtons[4];

  const newContentElement = newBlockDiv.querySelector(":first-child");

  newDeleteBtn.onclick = (e) => {
    e.stopPropagation();
    newBlockDiv.remove();
  };

  newSwapBtn.onclick = (e) => {
    e.stopPropagation();
    currentlySwappingBlock = newContentElement;
    const modulesModalEl = document.getElementById("modulesModal");
    const modal = bootstrap.Modal.getOrCreateInstance(modulesModalEl);
    modal.show();
  };

  newCloneBtn.onclick = (e) => {
    e.stopPropagation();
    cloneBlock(newBlockDiv);
  };

  newAddAfterBtn.onclick = (e) => {
    e.stopPropagation();
    currentlyInsertingBlockAfter = newBlockDiv;
    const modulesModalEl = document.getElementById("modulesModal");
    const modal = bootstrap.Modal.getOrCreateInstance(modulesModalEl);
    modal.show();
  };

  newCommentBtn.onclick = (e) => {
    e.stopPropagation();
    currentlyEditingNoteBlock = newBlockDiv;
    quillEditor.root.innerHTML = newBlockDiv.dataset.note;
    const noteModalEl = document.getElementById("noteModal");
    const modal = bootstrap.Modal.getOrCreateInstance(noteModalEl);
    modal.show();
  };

  const newOverlay = newBlockDiv.querySelector(".module-overlay");
  newOverlay.style.display = "";

  if (blockDiv.dataset.note.trim() !== "") {
    newBlockDiv.dataset.note = blockDiv.dataset.note;
    addNoteIndicator(newBlockDiv);
  }
  blockDiv.insertAdjacentElement("afterend", newBlockDiv);
}

function initializeSortable() {
  const canvas = document.getElementById("canvas");
  Sortable.create(canvas, {
    animation: 150,
    ghostClass: "sortable-ghost",
    onEnd: function () {
      // Optionally handle sorting event
    },
  });
}

function exportMockup() {
  const modules = Array.from(document.querySelectorAll("#canvas .block-container")).map((block) => {
    const el = block.querySelector(":first-child");
    return {
      category: el.dataset.category,
      desktop: el.dataset.desktop,
      mobile: el.dataset.mobile,
      note: block.dataset.note,
    };
  });
  const jsonStr = JSON.stringify(modules, null, 2);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "mockup.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function importMockup(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const modules = JSON.parse(e.target.result);
      const canvas = document.getElementById("canvas");
      canvas.innerHTML = "";
      modules.forEach((moduleData) => {
        const block = createModuleBlock(moduleData.category, {
          desktop: moduleData.desktop,
          mobile: moduleData.mobile,
        });
        if (moduleData.note && moduleData.note.trim() !== "") {
          block.dataset.note = moduleData.note;
          addNoteIndicator(block);
        }
        canvas.appendChild(block);
      });
    } catch (error) {
      alert("Error loading mockup: " + error);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function getModuleList() {
  const modules = Array.from(document.querySelectorAll("#canvas .block-container")).map((block) => {
    const el = block.querySelector(":first-child");
    const category = el.dataset.category;
    let displayName = viewMode === "mobile" ? el.dataset.mobile : el.dataset.desktop;
    if (category === "Spacers") {
      displayName = displayName + "px Spacer";
    } else if (category === "Custom") {
      displayName = el.dataset.moduleName;
    } else {
      displayName = displayName.replace(".svg", "");
    }
    const note = block.dataset.note.trim();
    return {
      name: displayName,
      note: note,
    };
  });
  let listHTML = "";
  modules.forEach((module) => {
    listHTML += `<div class="module-entry">
  <div class="module-name">${module.name}</div>`;
    if (module.note !== "") {
      listHTML += `<div class="module-note ql-editor">${module.note}</div>`;
    }
    listHTML += `</div>`;
  });
  const moduleListContainer = document.getElementById("moduleListContainer");
  moduleListContainer.innerHTML = listHTML;
  const listModalEl = document.getElementById("listModal");
  const modal = bootstrap.Modal.getOrCreateInstance(listModalEl);
  modal.show();
}

// Note functions using Quill rich text editor
function saveNote() {
  if (!currentlyEditingNoteBlock) return;
  const noteContent = quillEditor.root.innerHTML.trim();
  currentlyEditingNoteBlock.dataset.note = noteContent;

  const existingIndicator = currentlyEditingNoteBlock.querySelector(".note-indicator");
  if (noteContent !== "") {
    if (!existingIndicator) {
      addNoteIndicator(currentlyEditingNoteBlock);
    }
  } else {
    if (existingIndicator) {
      existingIndicator.remove();
    }
  }
  const noteModalEl = document.getElementById("noteModal");
  const modal = bootstrap.Modal.getOrCreateInstance(noteModalEl);
  modal.hide();
}

function addNoteIndicator(blockDiv) {
  if (blockDiv.querySelector(".note-indicator")) return;
  const indicator = document.createElement("div");
  indicator.classList.add("note-indicator");
  blockDiv.appendChild(indicator);
}
