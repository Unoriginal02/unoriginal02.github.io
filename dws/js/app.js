// ============================================================
// app.js — main application logic
// ============================================================

import { DAYS, TIME_SLOT_INTERVAL, COLOR_THEMES, AVAILABLE_COLORS, COLOR_DISPLAY_NAMES } from './config.js';
import { getAppState, saveAppState } from './db.js';
import {
    getApiToken, setApiToken, getSavedUser, initUserAndTeam,
    isConfigured, fetchTask, fetchAssignedTasks, registerTime, extractTaskId
} from './clickup.js';
import {
    timeToMinutes, minutesToTime, addMinutes, generateTimeSlots,
    getRandomArrayItem, toISODateLocal, parseISOToLocalDate,
    startOfWeekMonday, addDays, getCellHeight
} from './utils.js';
import {
    projectTaskPresets, setPresets, saveProjectTaskPreset,
    deleteProjectTaskPreset, getGroupedSortedPresets, movePreset
} from './presets.js';
import {
    scheduleNextNotification, requestNotificationPermission
} from './notifications.js';
import {
    scheduleTooltip, clearTooltipTimeout, hideTooltip,
    showBlockTooltip, showDayTooltip
} from './tooltip.js';

// ── State ────────────────────────────────────────────────────
let schedule = [];
let currentTheme = 'dark';
let weekMondayISO = null;
let notificationsEnabled = false;
let currentEditingBlock = null;
let originalCardSignature = null;
let modalLoggedState = false;
let modalShowProjectName = true;
let modalShowTaskName = true;
let selectedDay = null;

// ClickUp state
let cuTasksCache = null;

// Drag state
let draggedBlock = null;
let dragStartOffsetMinutes = 0;
let isCopyDrag = false;
let dragGhostEl = null;
let dragSourceEl = null;
let dragPendingDay = null;
let dragPendingStart = null;
let dragPendingEnd = null;

// Selection state
let isSelecting = false;
let selectionStartCell = null;
let selectionEndCell = null;
let selectedCells = [];

// ── DOM refs ─────────────────────────────────────────────────
const timetableBody = document.getElementById('timetable-body');
const timetableContainer = document.getElementById('timetable-container');
const startTimeInput = document.getElementById('startTime');
const endTimeInput = document.getElementById('endTime');
const weekMondayInput = document.getElementById('weekMonday');
const currentTimeLine = document.getElementById('currentTimeLine');

const thMonday = document.getElementById('thMonday');
const thTuesday = document.getElementById('thTuesday');
const thWednesday = document.getElementById('thWednesday');
const thThursday = document.getElementById('thThursday');
const thFriday = document.getElementById('thFriday');

const exportButton = document.getElementById('exportButton');
const importButton = document.getElementById('importButton');
const wipeButton = document.getElementById('wipeButton');
const importFileInput = document.getElementById('importFileInput');

const lightModeButton = document.getElementById('lightModeButton');
const darkModeButton = document.getElementById('darkModeButton');
const demureModeButton = document.getElementById('demureModeButton');

const timeBlockModalElement = document.getElementById('timeBlockModal');
const timeBlockModal = new bootstrap.Modal(timeBlockModalElement);
const timeBlockForm = document.getElementById('timeBlockForm');
const modalStartTime = document.getElementById('modalStartTime');
const modalEndTime = document.getElementById('modalEndTime');
const modalProjectName = document.getElementById('modalProjectName');
const modalTaskName = document.getElementById('modalTaskName');
const modalTaskId = document.getElementById('modalTaskId');
const modalDescription = document.getElementById('modalDescription');
const modalColor = document.getElementById('modalColor');
const loggedToggleButton = document.getElementById('loggedToggleButton');
const toggleProjectNameButton = document.getElementById('toggleProjectNameButton');
const toggleTaskNameButton = document.getElementById('toggleTaskNameButton');
const acceptButton = document.getElementById('acceptButton');
const deleteButton = document.getElementById('deleteButton');
const syncCardButton = document.getElementById('syncCardButton');
const openTaskLinkButton = document.getElementById('openTaskLinkButton');
const copyTaskIdButton = document.getElementById('copyTaskIdButton');
const copyDescriptionButton = document.getElementById('copyDescriptionButton');
const copyTotalTimeButton = document.getElementById('copyTotalTimeButton');
const openPresetListButton  = document.getElementById('openPresetListButton');
const presetList            = document.getElementById('presetList');
const taskPickerModalElement = document.getElementById('taskPickerModal');
const taskPickerModal        = new bootstrap.Modal(taskPickerModalElement);

const clickupSettingsButton  = document.getElementById('clickupSettingsButton');
const clickupTokenSection    = document.getElementById('clickupTokenSection');
const clickupTokenInput      = document.getElementById('clickupTokenInput');
const saveClickupTokenBtn    = document.getElementById('saveClickupTokenBtn');
const saveClickupIcon        = document.getElementById('saveClickupIcon');
const saveClickupLabel       = document.getElementById('saveClickupLabel');
const clickupConnectedInfo   = document.getElementById('clickupConnectedInfo');

const cuFetchRow     = document.getElementById('cuFetchRow');
const cuFetchInput   = document.getElementById('cuFetchInput');
const cuFetchBtn     = document.getElementById('cuFetchBtn');
const cuFetchIcon    = document.getElementById('cuFetchIcon');
const cuTasksSection = document.getElementById('cuTasksSection');
const cuTasksLoading = document.getElementById('cuTasksLoading');
const cuTasksList    = document.getElementById('cuTasksList');
const cuRefreshBtn   = document.getElementById('cuRefreshBtn');

const imputarRow             = document.getElementById('imputarRow');
const imputarButton          = document.getElementById('imputarButton');
const imputarIcon            = document.getElementById('imputarIcon');
const imputarLabel           = document.getElementById('imputarLabel');
const imputarGranularButton  = document.getElementById('imputarGranularButton');
const imputarGranularIcon    = document.getElementById('imputarGranularIcon');
const imputarGranularLabel   = document.getElementById('imputarGranularLabel');

const notifyToggle = document.getElementById('notifyToggle');

const prioritizationButton = document.getElementById('prioritizationButton');
const prioritizationPanel = document.getElementById('prioritizationPanel');
const closePrioritizationPanel = document.getElementById('closePrioritizationPanel');
const mainContent = document.getElementById('mainContent');

const prioTop3 = document.getElementById('prioTop3');
const prioOther = document.getElementById('prioOther');
const prioIdeas = document.getElementById('prioIdeas');
const prioTextareas = [prioTop3, prioOther, prioIdeas];

// ── Persistence ──────────────────────────────────────────────

async function saveSchedule() {
    const data = {
        schedule,
        startTime: startTimeInput.value,
        endTime: endTimeInput.value,
        theme: currentTheme,
        notificationsEnabled,
        prioritization: {
            top3: prioTop3.value,
            other: prioOther.value,
            ideas: prioIdeas.value
        },
        projectTaskPresets,
        exportDate: new Date().toISOString().split('T')[0]
    };
    try {
        await saveAppState(data);
    } catch (err) {
        console.error('Failed to save state:', err);
    }
    scheduleNextNotification(schedule, notificationsEnabled);
}

async function loadSchedule() {
    try {
        const data = await getAppState();
        if (data) {
            schedule = data.schedule || [];
            setPresets(data.projectTaskPresets || []);
            startTimeInput.value = data.startTime || '08:00';
            endTimeInput.value = data.endTime || '18:00';
            currentTheme = data.theme || 'dark';
            notificationsEnabled = data.notificationsEnabled || false;

            // Migrate old blocks missing new fields
            schedule.forEach(block => {
                if (block.taskName === undefined) block.taskName = '';
                if (block.taskId === undefined) block.taskId = '';
                if (block.description === undefined) block.description = '';
                if (block.logged === undefined) block.logged = false;
            });

            const prio = data.prioritization || {};
            prioTop3.value = prio.top3 || '';
            prioOther.value = prio.other || '';
            prioIdeas.value = prio.ideas || '';
        } else {
            currentTheme = 'dark';
            notificationsEnabled = false;
        }

        // Always snap to current week's Monday on load
        const monday = startOfWeekMonday(new Date());
        weekMondayISO = toISODateLocal(monday);
        weekMondayInput.value = weekMondayISO;

        notifyToggle.checked = notificationsEnabled;

        if (notificationsEnabled) {
            const granted = await requestNotificationPermission();
            if (!granted) {
                notificationsEnabled = false;
                notifyToggle.checked = false;
                await saveSchedule();
            }
        }

        updateWeekHeaderLabels();
    } catch (err) {
        console.error('Failed to load state:', err);
        schedule = [];
        currentTheme = 'dark';
        notificationsEnabled = false;
        updateWeekHeaderLabels();
    }
}

// ── Week header ───────────────────────────────────────────────

function updateWeekHeaderLabels() {
    const headers = [thMonday, thTuesday, thWednesday, thThursday, thFriday];
    const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    if (!weekMondayISO) {
        headers.forEach((th, i) => { if (th) th.textContent = names[i]; });
        return;
    }

    const monday = parseISOToLocalDate(weekMondayISO);
    headers.forEach((th, i) => {
        if (th) th.textContent = `${names[i]} ${addDays(monday, i).getDate()}`;
    });
}

// ── Color helpers ─────────────────────────────────────────────

function getAutoColorForNewBlock(day, startTime) {
    const startMinutes = timeToMinutes(startTime);
    const autoColors = AVAILABLE_COLORS.filter(c => c !== 'gray');

    const previousBlocks = schedule
        .filter(b => b.day === day && timeToMinutes(b.start) <= startMinutes)
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    if (previousBlocks.length === 0) return getRandomArrayItem(autoColors);

    const lastTwoColors = previousBlocks.slice(-2).map(b => b.colorName).filter(Boolean);
    let candidates = autoColors.filter(c => !lastTwoColors.includes(c));
    if (candidates.length === 0) candidates = [...autoColors];

    const counts = Object.fromEntries(candidates.map(c => [c, 0]));
    previousBlocks.forEach(b => { if (counts.hasOwnProperty(b.colorName)) counts[b.colorName]++; });

    const minCount = Math.min(...Object.values(counts));
    const leastUsed = candidates.filter(c => counts[c] === minCount);
    return getRandomArrayItem(leastUsed);
}

function populateColorOptions() {
    modalColor.innerHTML = '';
    AVAILABLE_COLORS.forEach(colorKey => {
        const option = document.createElement('option');
        option.value = colorKey;
        const hex = COLOR_THEMES[currentTheme][colorKey];
        const label = COLOR_DISPLAY_NAMES[colorKey] || colorKey;
        option.textContent = `■ ${label}`;
        option.style.color = hex;
        option.style.fontWeight = '700';
        modalColor.appendChild(option);
    });
}

// ── Table rendering ───────────────────────────────────────────

function clearTable() {
    timetableBody.innerHTML = '';
    document.querySelectorAll('.time-block').forEach(b => b.remove());
}

function renderTable() {
    clearTable();
    const start = startTimeInput.value || '08:00';
    const end = endTimeInput.value || '18:00';
    const slots = generateTimeSlots(start, end, TIME_SLOT_INTERVAL);
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const todayIndex = DAYS.indexOf(today); // -1 if not a weekday

    slots.forEach(time => {
        const tr = document.createElement('tr');
        const timeTd = document.createElement('td');
        timeTd.textContent = time;
        tr.appendChild(timeTd);

        DAYS.forEach((day, i) => {
            const td = document.createElement('td');
            td.classList.add('time-slot');
            td.dataset.day = day;
            td.dataset.time = time;

            if (i === todayIndex) td.classList.add('current-day');

            td.addEventListener('mousedown', onCellMouseDown);
            td.addEventListener('mouseover', onCellMouseOver);


            tr.appendChild(td);
        });

        timetableBody.appendChild(tr);
    });

    // Highlight current day header
    document.querySelectorAll('.table thead th').forEach((th, i) => {
        // i=0 is "Time" column; day headers start at i=1
        th.classList.toggle('current-day', i === todayIndex + 1);
    });

    // Day header tooltips
    const dayHeaderMap = { thMonday: 'Monday', thTuesday: 'Tuesday', thWednesday: 'Wednesday', thThursday: 'Thursday', thFriday: 'Friday' };
    Object.entries(dayHeaderMap).forEach(([id, day]) => {
        const th = document.getElementById(id);
        if (!th) return;
        th.style.cursor = 'pointer';
        th.onmouseenter = () => scheduleTooltip(() => showDayTooltip(day, schedule));
        th.onmouseleave = () => { clearTooltipTimeout(); hideTooltip(); };
    });

    updateWeekHeaderLabels();
    renderSchedule();
    updateCurrentTimeLine();
}

// ── Schedule (time block) rendering ──────────────────────────

/**
 * Build a lookup of { leftPx, widthPx } for each day column by measuring
 * the actual rendered <th> cells relative to the timetable container.
 */
function getDayColumnRects() {
    const containerRect = timetableContainer.getBoundingClientRect();
    const thEls = [
        document.getElementById('thMonday'),
        document.getElementById('thTuesday'),
        document.getElementById('thWednesday'),
        document.getElementById('thThursday'),
        document.getElementById('thFriday'),
    ];
    return thEls.map(th => {
        if (!th) return { leftPx: 0, widthPx: 0 };
        const r = th.getBoundingClientRect();
        return {
            leftPx: r.left - containerRect.left,
            widthPx: r.width,
        };
    });
}

function renderSchedule() {
    document.querySelectorAll('.time-block').forEach(b => b.remove());

    const cellHeight = getCellHeight();
    const headerHeight = document.querySelector('.table thead').offsetHeight;
    const scheduleStart = timeToMinutes(startTimeInput.value);
    const scheduleEnd = timeToMinutes(endTimeInput.value);
    const dayRects = getDayColumnRects();

    schedule.forEach(block => {
        const dayIndex = DAYS.indexOf(block.day);
        if (dayIndex === -1) return;

        const startMin = timeToMinutes(block.start);
        const endMin = timeToMinutes(block.end);
        const adjStart = Math.max(startMin, scheduleStart);
        const adjEnd = Math.min(endMin, scheduleEnd);
        if (adjEnd <= adjStart) return;

        const topPx = ((adjStart - scheduleStart) / TIME_SLOT_INTERVAL) * cellHeight + headerHeight;
        const heightPx = ((adjEnd - adjStart) / TIME_SLOT_INTERVAL) * cellHeight;
        const { leftPx, widthPx } = dayRects[dayIndex];
        const colorHex = COLOR_THEMES[currentTheme][block.colorName] || '#FFFFFF';

        const blockDiv = document.createElement('div');
        blockDiv.classList.add('time-block');
        blockDiv.style.top = `${topPx}px`;
        blockDiv.style.left = `${leftPx}px`;
        blockDiv.style.width = `${widthPx}px`;
        blockDiv.style.height = `${heightPx}px`;
        blockDiv.style.backgroundColor = 'var(--background-color)';
        blockDiv.style.borderLeft = `8px solid ${colorHex}`;

        // Resize handles
        const topHandle = document.createElement('div');
        topHandle.classList.add('resize-handle', 'top');
        blockDiv.appendChild(topHandle);

        const bottomHandle = document.createElement('div');
        bottomHandle.classList.add('resize-handle', 'bottom');
        blockDiv.appendChild(bottomHandle);

        // Content
        if (block.projectName && block.showProjectName !== false) {
            const el = document.createElement('div');
            el.style.fontWeight = 'bold';
            el.textContent = block.projectName;
            blockDiv.appendChild(el);
        }

        if (block.taskName && block.showTaskName !== false) {
            const el = document.createElement('div');
            el.textContent = block.taskName;
            blockDiv.appendChild(el);
        }

        // Logged indicator (once)
        if (block.logged) {
            const dot = document.createElement('div');
            dot.className = 'logged-indicator';
            dot.title = 'Already logged';
            blockDiv.appendChild(dot);
        }

        // Drag
        blockDiv.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle')) return;
            draggedBlock = block;
            dragSourceEl = blockDiv;
            isCopyDrag = e.shiftKey;
            document.body.classList.add('dragging');
            const clickOffsetPx = e.clientY - timetableContainer.getBoundingClientRect().top - parseFloat(blockDiv.style.top);
            const offsetSlots = Math.round(clickOffsetPx / getCellHeight());
            dragStartOffsetMinutes = -Math.max(0, offsetSlots * TIME_SLOT_INTERVAL);

            dragGhostEl = document.createElement('div');
            dragGhostEl.className = 'time-block drag-ghost';
            dragGhostEl.style.cssText = blockDiv.style.cssText;
            dragGhostEl.style.pointerEvents = 'none';
            timetableContainer.appendChild(dragGhostEl);
            blockDiv.classList.add('dragging-source');

            document.addEventListener('mousemove', onDragMouseMove);
            document.addEventListener('mouseup', onDragEnd);
        });

        // Click → edit
        blockDiv.addEventListener('click', (e) => { e.stopPropagation(); openModal(block); });

        // Tooltip
        blockDiv.addEventListener('mouseover', (e) => {
            if (draggedBlock) return;
            if (!blockDiv.contains(e.relatedTarget)) {
                scheduleTooltip(() => showBlockTooltip(block, schedule, currentTheme));
            }
        });
        blockDiv.addEventListener('mouseout', (e) => {
            if (!blockDiv.contains(e.relatedTarget)) { clearTooltipTimeout(); hideTooltip(); }
        });

        timetableContainer.appendChild(blockDiv);
        addResizeListeners(blockDiv, block);
    });
}

// ── Drag & Drop ───────────────────────────────────────────────

function onDragMouseMove(e) {
    if (!draggedBlock || !dragGhostEl) return;

    const containerRect = timetableContainer.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    const cellHeight = getCellHeight();
    const headerHeight = document.querySelector('.table thead').offsetHeight;
    const scheduleStart = timeToMinutes(startTimeInput.value);
    const scheduleEnd = timeToMinutes(endTimeInput.value);
    const dayRects = getDayColumnRects();

    let dayIndex = -1;
    for (let i = 0; i < dayRects.length; i++) {
        const { leftPx, widthPx } = dayRects[i];
        if (mouseX >= leftPx && mouseX < leftPx + widthPx) { dayIndex = i; break; }
    }

    if (dayIndex === -1) {
        dragPendingDay = null;
        dragGhostEl.style.opacity = '0';
        return;
    }

    const slotIndex = Math.floor((mouseY - headerHeight) / cellHeight);
    const cellTime = scheduleStart + slotIndex * TIME_SLOT_INTERVAL;
    const startMinutes = Math.max(scheduleStart, cellTime + dragStartOffsetMinutes);

    const day = DAYS[dayIndex];
    const originalDuration = timeToMinutes(draggedBlock.end) - timeToMinutes(draggedBlock.start);
    const nextBlockStart = getNextBlockStart(day, startMinutes, isCopyDrag ? null : draggedBlock.id);
    const endMinutes = Math.min(startMinutes + originalDuration, nextBlockStart, scheduleEnd);

    if (endMinutes <= startMinutes) {
        dragPendingDay = null;
        dragGhostEl.style.opacity = '0';
        return;
    }

    dragPendingDay = day;
    dragPendingStart = startMinutes;
    dragPendingEnd = endMinutes;

    const topPx = ((startMinutes - scheduleStart) / TIME_SLOT_INTERVAL) * cellHeight + headerHeight;
    const heightPx = ((endMinutes - startMinutes) / TIME_SLOT_INTERVAL) * cellHeight;
    const { leftPx, widthPx } = dayRects[dayIndex];

    dragGhostEl.style.opacity = '';
    dragGhostEl.style.top = `${topPx}px`;
    dragGhostEl.style.left = `${leftPx}px`;
    dragGhostEl.style.width = `${widthPx}px`;
    dragGhostEl.style.height = `${heightPx}px`;
}

function onDragEnd() {
    document.removeEventListener('mousemove', onDragMouseMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.body.classList.remove('dragging');

    if (dragGhostEl) { dragGhostEl.remove(); dragGhostEl = null; }
    if (dragSourceEl) { dragSourceEl.classList.remove('dragging-source'); dragSourceEl = null; }

    if (draggedBlock && dragPendingDay !== null) {
        const newBlock = isCopyDrag ? { ...draggedBlock, id: Date.now() } : draggedBlock;
        newBlock.day = dragPendingDay;
        newBlock.start = minutesToTime(dragPendingStart);
        newBlock.end = minutesToTime(dragPendingEnd);
        if (isCopyDrag) schedule.push(newBlock);
        saveSchedule();
        renderSchedule();
    }

    draggedBlock = null;
    dragPendingDay = null;
    dragPendingStart = null;
    dragPendingEnd = null;
}

function getNextBlockStart(day, afterMinutes, ignoreId) {
    return schedule
        .filter(b => b.day === day && b.id !== ignoreId && timeToMinutes(b.start) > afterMinutes)
        .map(b => timeToMinutes(b.start))
        .sort((a, b) => a - b)[0] ?? Infinity;
}

// ── Cell selection ────────────────────────────────────────────

function onCellMouseDown(e) {
    e.preventDefault();
    isSelecting = true;
    selectionStartCell = e.currentTarget;
    selectionEndCell = e.currentTarget;
    selectedDay = selectionStartCell.dataset.day;
    selectedCells = [selectionStartCell];
    selectionStartCell.classList.add('selected-range');
}

function onCellMouseOver(e) {
    if (!isSelecting) return;
    const cell = e.currentTarget;
    if (cell.dataset.day !== selectedDay) return;

    selectionEndCell = cell;
    clearSelectedRange();

    const allCells = Array.from(document.querySelectorAll(`.time-slot[data-day="${selectedDay}"]`));
    const startIdx = allCells.indexOf(selectionStartCell);
    const endIdx = allCells.indexOf(selectionEndCell);
    if (startIdx === -1 || endIdx === -1) return;

    const [min, max] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
    selectedCells = allCells.slice(min, max + 1);
    selectedCells.forEach(c => c.classList.add('selected-range'));
}

function onMouseUpDocument() {
    if (!isSelecting) return;
    isSelecting = false;
    if (selectedCells.length === 0) return;

    const times = selectedCells.map(c => timeToMinutes(c.dataset.time));
    const startTime = minutesToTime(Math.min(...times));
    const endTime = minutesToTime(Math.max(...times) + TIME_SLOT_INTERVAL);

    if (checkConflict(selectedDay, startTime, endTime)) {
        alert('Conflicting time. Please choose a different time slot.');
        clearSelectedRange();
        return;
    }

    openModal(null, selectedDay, startTime, endTime);
    clearSelectedRange();
}


function clearSelectedRange() {
    selectedCells.forEach(c => c.classList.remove('selected-range'));
    selectedCells = [];
}

// ── Conflict check ────────────────────────────────────────────

function checkConflict(day, start, end, excludeId = null) {
    const newStart = timeToMinutes(start);
    const newEnd = timeToMinutes(end);
    return schedule.some(block => {
        if (block.day !== day) return false;
        if (excludeId && block.id === excludeId) return false;
        const bs = timeToMinutes(block.start);
        const be = timeToMinutes(block.end);
        return !(newEnd <= bs || newStart >= be);
    });
}

// ── Modal ─────────────────────────────────────────────────────

function openModal(block = null, day = null, startTime = null, endTime = null) {
    currentEditingBlock = block;
    taskPickerModal.hide();

    if (block) {
        modalStartTime.value = block.start;
        modalEndTime.value = block.end;
        modalProjectName.value = block.projectName || '';
        modalTaskName.value = block.taskName || '';
        modalTaskId.value = block.taskId || '';
        modalDescription.value = block.description || '';
        modalColor.value = block.colorName;
        modalLoggedState = block.logged === true;
        modalShowProjectName = block.showProjectName !== false;
        modalShowTaskName = block.showTaskName !== false;
        deleteButton.style.display = 'inline-flex';
        syncCardButton.style.display = 'inline-flex';
        originalCardSignature = {
            projectName: block.projectName || '',
            taskName: block.taskName || '',
            description: block.description || '',
            taskId: block.taskId || '',
            colorName: block.colorName
        };
    } else {
        modalStartTime.value = startTime || '08:00';
        modalEndTime.value = endTime || addMinutes(startTime || '08:00', TIME_SLOT_INTERVAL);
        modalProjectName.value = '';
        modalTaskName.value = '';
        modalTaskId.value = '';
        modalDescription.value = '-';
        modalColor.value = getAutoColorForNewBlock(day, modalStartTime.value);
        modalLoggedState = false;
        modalShowProjectName = true;
        const newDuration = timeToMinutes(modalEndTime.value) - timeToMinutes(modalStartTime.value);
        modalShowTaskName = newDuration > TIME_SLOT_INTERVAL;
        deleteButton.style.display = 'none';
        syncCardButton.style.display = 'none';
        originalCardSignature = null;
    }

    loggedToggleButton.classList.toggle('logged-active', modalLoggedState);
    updateVisibilityToggle(toggleProjectNameButton, modalShowProjectName);
    updateVisibilityToggle(toggleTaskNameButton, modalShowTaskName);

    const showImputar = isConfigured() && !!(block?.taskId);
    imputarRow.style.display = showImputar ? 'flex' : 'none';
    imputarIcon.className = 'bi bi-layers';
    imputarLabel.textContent = 'Block Log';
    imputarButton.disabled = false;
    imputarGranularIcon.className = 'bi bi-card-checklist';
    imputarGranularLabel.textContent = 'Granular Log';
    imputarGranularButton.disabled = false;

    timeBlockModal.show();
}

function closeModal() {
    timeBlockModal.hide();
    currentEditingBlock = null;
    selectedDay = null;
}

function saveBlock() {
    const day = currentEditingBlock ? currentEditingBlock.day : selectedDay;
    const start = modalStartTime.value;
    const end = modalEndTime.value;
    const projectName = modalProjectName.value.trim();
    const taskName = modalTaskName.value.trim();
    const taskId = modalTaskId.value.trim();
    const description = modalDescription.value.trim();
    const colorName = modalColor.value;
    const logged = modalLoggedState;
    const showProjectName = modalShowProjectName;
    const showTaskName = modalShowTaskName;

    if (timeToMinutes(end) <= timeToMinutes(start)) {
        alert('End time must be after start time.');
        return;
    }

    if (checkConflict(day, start, end, currentEditingBlock ? currentEditingBlock.id : null)) {
        alert('Conflicting time. Please choose a different time slot.');
        return;
    }

    if (currentEditingBlock) {
        Object.assign(currentEditingBlock, { projectName, taskName, taskId, description, colorName, logged, showProjectName, showTaskName, start, end });
    } else {
        schedule.push({ id: Date.now(), day, start, end, projectName, taskName, taskId, description, colorName, logged, showProjectName, showTaskName });
    }

    saveProjectTaskPreset({ projectName, taskName, taskId });
    saveSchedule();
    renderTable();
    closeModal();
}

function deleteBlock() {
    if (!currentEditingBlock) return;
    if (!confirm('Are you sure you want to delete this time block?')) return;
    schedule = schedule.filter(b => b.id !== currentEditingBlock.id);
    saveSchedule();
    renderTable();
    closeModal();
}

function syncCard() {
    if (!currentEditingBlock || !originalCardSignature) {
        alert('Open an existing card first to sync.');
        return;
    }

    const projectName = modalProjectName.value.trim();
    const taskName = modalTaskName.value.trim();
    const taskId = modalTaskId.value.trim();
    const description = modalDescription.value.trim();
    const colorName = modalColor.value;
    const logged = modalLoggedState;

    const { projectName: op, taskName: ot, description: od, taskId: oid, colorName: oc } = originalCardSignature;

    schedule.forEach(block => {
        if (
            (block.projectName || '').trim() === op &&
            (block.taskName || '').trim() === ot &&
            (block.description || '').trim() === od &&
            (block.taskId || '').trim() === oid &&
            block.colorName === oc
        ) {
            Object.assign(block, { projectName, taskName, taskId, description, colorName, logged });
        }
    });

    originalCardSignature = { projectName, taskName, description, taskId, colorName };
    saveSchedule();
    renderTable();
}

function toggleLoggedState() {
    const colorName = modalColor.value;
    modalLoggedState = !modalLoggedState;
    loggedToggleButton.classList.toggle('logged-active', modalLoggedState);

    if (currentEditingBlock) {
        const day = currentEditingBlock.day;
        const pn = (currentEditingBlock.projectName || '').trim();
        const tn = (currentEditingBlock.taskName || '').trim();
        const desc = (currentEditingBlock.description || '').trim();
        const tid = (currentEditingBlock.taskId || '').trim();

        schedule.forEach(block => {
            if (
                block.day === day &&
                (block.projectName || '').trim() === pn &&
                (block.taskName || '').trim() === tn &&
                (block.description || '').trim() === desc &&
                (block.taskId || '').trim() === tid &&
                block.colorName === colorName
            ) {
                block.logged = modalLoggedState;
            }
        });

        currentEditingBlock.logged = modalLoggedState;
        saveSchedule();
        renderSchedule();
    }
}

// ── Visibility toggles ────────────────────────────────────────

function updateVisibilityToggle(btn, isVisible) {
    btn.querySelector('i').className = isVisible ? 'bi bi-eye' : 'bi bi-eye-slash';
    btn.classList.toggle('visibility-hidden', !isVisible);
}

toggleProjectNameButton.addEventListener('click', () => {
    modalShowProjectName = !modalShowProjectName;
    updateVisibilityToggle(toggleProjectNameButton, modalShowProjectName);
});

toggleTaskNameButton.addEventListener('click', () => {
    modalShowTaskName = !modalShowTaskName;
    updateVisibilityToggle(toggleTaskNameButton, modalShowTaskName);
});

// ── Clipboard actions ─────────────────────────────────────────

function copyTaskId() {
    if (!currentEditingBlock) return;
    const v = (currentEditingBlock.taskId || '').trim();
    if (!v) { alert('This task has no Task ID.'); return; }
    navigator.clipboard.writeText(v).catch(err => alert('Failed to copy: ' + err));
}

function copyDescriptionOnly() {
    if (!currentEditingBlock) return;
    const v = (currentEditingBlock.description || '').trim();
    if (!v) { alert('This task has no description.'); return; }
    navigator.clipboard.writeText(v).catch(err => alert('Failed to copy: ' + err));
}

function copyTotalTimeForSameTaskSameDay() {
    if (!currentEditingBlock) return;
    const day = currentEditingBlock.day;
    const projectName = (currentEditingBlock.projectName || '').trim();
    const description = (currentEditingBlock.description || '').trim();

    const totalMinutes = schedule
        .filter(b =>
            b.day === day &&
            (b.projectName || '').trim() === projectName &&
            (b.description || '').trim() === description
        )
        .reduce((sum, b) => sum + Math.max(0, timeToMinutes(b.end) - timeToMinutes(b.start)), 0);

    const decimalHours = (totalMinutes / 60).toFixed(2).replace(/\.00$/, '');
    navigator.clipboard.writeText(decimalHours).catch(err => alert('Failed to copy: ' + err));
}

function openTaskLink() {
    const taskId = (modalTaskId.value || '').trim();
    if (!taskId) { alert('Please enter a Task ID first.'); return; }
    window.open(`https://app.clickup.com/t/${encodeURIComponent(taskId)}`, '_blank', 'noopener,noreferrer');
}

// ── ClickUp integration ────────────────────────────────────────

function updateClickUpUI() {
    const user = getSavedUser();
    if (user) {
        clickupSettingsButton.innerHTML = `<i class="bi bi-plug-fill"></i> ${user.userName}`;
        clickupConnectedInfo.textContent = `Connected as ${user.userName}`;
        clickupConnectedInfo.style.display = 'block';
    } else {
        clickupSettingsButton.innerHTML = '<i class="bi bi-plug"></i> ClickUp';
        clickupConnectedInfo.style.display = 'none';
    }
    const configured = isConfigured();
    cuFetchRow.style.display     = configured ? 'block' : 'none';
    cuTasksSection.style.display = configured ? 'block' : 'none';
}

async function cuFetchFromPreset() {
    const raw = cuFetchInput.value.trim();
    if (!raw) { alert('Paste a task ID or ClickUp URL first.'); return; }

    cuFetchIcon.className = 'bi bi-hourglass-split';
    cuFetchBtn.disabled = true;

    try {
        const task = await fetchTask(raw, getApiToken());
        modalProjectName.value = task.list?.name || task.space?.name || '';
        modalTaskName.value    = task.name || '';
        modalTaskId.value      = task.id;
        cuFetchInput.value     = '';
        taskPickerModal.hide();
        modalProjectName.focus();
    } catch (err) {
        alert(err.message);
    } finally {
        cuFetchIcon.className = 'bi bi-cloud-download';
        cuFetchBtn.disabled = false;
    }
}

function makeCuOpenLink(taskId, taskUrl) {
    const a = document.createElement('a');
    a.href = taskUrl || `https://app.clickup.com/t/${taskId}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.className = 'btn btn-sm px-1';
    a.innerHTML = '<i class="bi bi-box-arrow-up-right" style="font-size:0.7rem;opacity:0.6;"></i>';
    a.title = 'Open in ClickUp';
    a.addEventListener('click', e => e.stopPropagation());
    return a;
}

function renderCuTasks(tasks) {
    cuTasksList.innerHTML = '';
    if (!tasks.length) {
        const empty = document.createElement('div');
        empty.className = 'list-group-item';
        empty.style.fontSize = '0.8rem';
        empty.textContent = 'No open tasks assigned to you.';
        cuTasksList.appendChild(empty);
        return;
    }

    // Separate subtasks from parents
    const subtasksByParent = {};
    const parentTasks = [];
    tasks.forEach(task => {
        if (task.parent) {
            if (!subtasksByParent[task.parent]) subtasksByParent[task.parent] = [];
            subtasksByParent[task.parent].push(task);
        } else {
            parentTasks.push(task);
        }
    });

    // Group parents by list
    const groups = {};
    parentTasks.forEach(task => {
        const key = task.list?.name || 'No List';
        if (!groups[key]) groups[key] = [];
        groups[key].push(task);
    });

    Object.entries(groups).forEach(([listName, listTasks]) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'list-group-item preset-project-group';

        const header = document.createElement('div');
        header.className = 'project-group-header d-flex align-items-center gap-1';

        const headerLabel = document.createElement('span');
        headerLabel.className = 'flex-grow-1';
        headerLabel.textContent = listName;
        header.appendChild(headerLabel);

        const listId = listTasks[0]?.list?.id;
        if (listId) {
            const teamId = getSavedUser()?.teamId;
            const listLink = document.createElement('a');
            listLink.href = teamId
                ? `https://app.clickup.com/${teamId}/v/li/${listId}`
                : `https://app.clickup.com/t/li/${listId}`;
            listLink.target = '_blank';
            listLink.rel = 'noopener noreferrer';
            listLink.className = 'btn btn-sm px-1';
            listLink.innerHTML = '<i class="bi bi-box-arrow-up-right" style="font-size:0.7rem;opacity:0.6;"></i>';
            listLink.title = 'Open list in ClickUp';
            listLink.addEventListener('click', e => e.stopPropagation());
            header.appendChild(listLink);
        }

        wrapper.appendChild(header);

        listTasks.forEach(task => {
            const row = document.createElement('div');
            row.className = 'project-task-row d-flex align-items-center gap-2 py-1';

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-sm flex-grow-1 text-start';
            btn.textContent = task.name;
            btn.addEventListener('click', () => {
                modalProjectName.value = listName;
                modalTaskName.value    = task.name;
                modalTaskId.value      = task.id;
                taskPickerModal.hide();
            });

            row.appendChild(btn);
            row.appendChild(makeCuOpenLink(task.id, task.url));
            wrapper.appendChild(row);

            // Subtask rows indented under the parent
            (subtasksByParent[task.id] || []).forEach(sub => {
                const subRow = document.createElement('div');
                subRow.className = 'project-task-row d-flex align-items-center gap-2 py-1';
                subRow.style.paddingLeft = '1.25rem';

                const subBtn = document.createElement('button');
                subBtn.type = 'button';
                subBtn.className = 'btn btn-sm flex-grow-1 text-start';
                subBtn.style.fontSize = '0.85em';
                subBtn.textContent = `↳ ${sub.name}`;
                subBtn.addEventListener('click', () => {
                    modalProjectName.value = listName;
                    modalTaskName.value    = sub.name;
                    modalTaskId.value      = sub.id;
                    taskPickerModal.hide();
                });

                subRow.appendChild(subBtn);
                subRow.appendChild(makeCuOpenLink(sub.id, sub.url));
                wrapper.appendChild(subRow);
            });
        });

        cuTasksList.appendChild(wrapper);
    });
}

async function loadCuTasks(force = false) {
    if (!isConfigured()) return;
    if (!force && cuTasksCache !== null) { renderCuTasks(cuTasksCache); return; }

    cuTasksLoading.style.display = 'block';
    cuTasksList.innerHTML = '';

    try {
        const user = getSavedUser();
        const tasks = await fetchAssignedTasks(getApiToken(), user.teamId, user.userId);
        cuTasksCache = tasks;
        renderCuTasks(tasks);
    } catch (err) {
        cuTasksList.innerHTML = `<div class="list-group-item" style="color:var(--button-active-color);font-size:0.8rem;">${err.message}</div>`;
    } finally {
        cuTasksLoading.style.display = 'none';
    }
}

async function imputarHoras() {
    if (!currentEditingBlock?.taskId || !isConfigured()) return;

    const taskId = currentEditingBlock.taskId.trim();
    const day    = currentEditingBlock.day;

    const relatedBlocks = schedule.filter(b =>
        b.day === day && (b.taskId || '').trim() === taskId
    );

    const totalMinutes = relatedBlocks.reduce(
        (sum, b) => sum + Math.max(0, timeToMinutes(b.end) - timeToMinutes(b.start)), 0
    );
    if (totalMinutes === 0) { alert('No time to register.'); return; }

    const earliest = [...relatedBlocks].sort(
        (a, b) => timeToMinutes(a.start) - timeToMinutes(b.start)
    )[0];

    const dayIndex  = DAYS.indexOf(day);
    const monday    = parseISOToLocalDate(weekMondayISO);
    const blockDate = addDays(monday, dayIndex);
    const [h, m]    = earliest.start.split(':').map(Number);
    blockDate.setHours(h, m, 0, 0);
    const startTs    = blockDate.getTime();
    const durationMs = totalMinutes * 60 * 1000;
    const description = currentEditingBlock.description || '';
    const user = getSavedUser();

    imputarIcon.className = 'bi bi-hourglass-split';
    imputarButton.disabled = true;

    let success = false;
    try {
        await registerTime(getApiToken(), taskId, user?.teamId, startTs, durationMs, description, user?.userId);
        success = true;
        relatedBlocks.forEach(b => { b.logged = true; });
        if (currentEditingBlock) currentEditingBlock.logged = true;
        loggedToggleButton.classList.add('logged-active');
        modalLoggedState = true;
        saveSchedule();
        renderSchedule();
    } catch (err) {
        alert(err.message);
    } finally {
        if (success) {
            imputarIcon.className = 'bi bi-check-circle';
            imputarLabel.textContent = 'Logged!';
            setTimeout(() => {
                imputarIcon.className = 'bi bi-layers';
                imputarLabel.textContent = 'Block Log';
                imputarButton.disabled = false;
            }, 2500);
        } else {
            imputarIcon.className = 'bi bi-layers';
            imputarButton.disabled = false;
        }
    }
}

async function imputarGranular() {
    if (!currentEditingBlock?.taskId || !isConfigured()) return;

    const taskId = currentEditingBlock.taskId.trim();
    const day    = currentEditingBlock.day;
    const user   = getSavedUser();

    const relatedBlocks = schedule.filter(b =>
        b.day === day && (b.taskId || '').trim() === taskId
    );
    if (!relatedBlocks.length) { alert('No time to register.'); return; }

    imputarGranularIcon.className = 'bi bi-hourglass-split';
    imputarGranularButton.disabled = true;

    const dayIndex = DAYS.indexOf(day);
    const monday   = parseISOToLocalDate(weekMondayISO);
    const baseDate = addDays(monday, dayIndex);

    const results = await Promise.allSettled(relatedBlocks.map(block => {
        const [h, m] = block.start.split(':').map(Number);
        const d = new Date(baseDate);
        d.setHours(h, m, 0, 0);
        const startTs    = d.getTime();
        const durationMs = (timeToMinutes(block.end) - timeToMinutes(block.start)) * 60 * 1000;
        return registerTime(getApiToken(), taskId, user?.teamId, startTs, durationMs, block.description || '', user?.userId);
    }));

    const errors = [];
    results.forEach((result, i) => {
        if (result.status === 'fulfilled') {
            relatedBlocks[i].logged = true;
        } else {
            errors.push(result.reason?.message || 'Unknown error');
        }
    });

    // currentEditingBlock is a reference into schedule, so its .logged was updated above
    loggedToggleButton.classList.toggle('logged-active', currentEditingBlock?.logged === true);
    modalLoggedState = currentEditingBlock?.logged === true;
    saveSchedule();
    renderSchedule();

    if (errors.length === 0) {
        imputarGranularIcon.className = 'bi bi-check-circle';
        imputarGranularLabel.textContent = 'Logged!';
        setTimeout(() => {
            imputarGranularIcon.className = 'bi bi-card-checklist';
            imputarGranularLabel.textContent = 'Granular Log';
            imputarGranularButton.disabled = false;
        }, 2500);
    } else {
        alert(errors.join('\n'));
        imputarGranularIcon.className = 'bi bi-card-checklist';
        imputarGranularButton.disabled = false;
    }
}

// ── Export / Import ───────────────────────────────────────────

function exportSchedule() {
    const data = {
        schedule,
        startTime: startTimeInput.value,
        endTime: endTimeInput.value,
        projectTaskPresets,
        theme: currentTheme,
        notificationsEnabled,
        prioritization: { top3: prioTop3.value, other: prioOther.value, ideas: prioIdeas.value },
        weekMondayISO
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;

    const now = new Date();
    const savedDate = toISODateLocal(now);
    const savedTime = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join('-');
    const mondayStr = weekMondayISO || 'unknown-monday';

    a.download = `DWS WEEK ${mondayStr} - Saved on ${savedDate}_${savedTime}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importSchedule(file) {
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (!imported || !Array.isArray(imported.schedule)) throw new Error('Invalid schedule format.');

            schedule = imported.schedule;
            startTimeInput.value = imported.startTime || '08:00';
            endTimeInput.value = imported.endTime || '18:00';
            currentTheme = imported.theme || 'dark';
            notificationsEnabled = imported.notificationsEnabled || false;
            setPresets(imported.projectTaskPresets || []);

            schedule.forEach(block => {
                if (block.taskName === undefined) block.taskName = '';
                if (block.taskId === undefined) block.taskId = '';
                if (block.description === undefined) block.description = '';
                if (block.logged === undefined) block.logged = false;
            });

            const prio = imported.prioritization || {};
            prioTop3.value = prio.top3 || '';
            prioOther.value = prio.other || '';
            prioIdeas.value = prio.ideas || '';

            weekMondayISO = imported.weekMondayISO || toISODateLocal(startOfWeekMonday(new Date()));
            weekMondayInput.value = weekMondayISO;

            notifyToggle.checked = notificationsEnabled;
            if (notificationsEnabled) {
                const granted = await requestNotificationPermission();
                if (!granted) { notificationsEnabled = false; notifyToggle.checked = false; }
            }

            await saveSchedule();
            populateColorOptions();
            switchTheme(currentTheme);
            renderTable();
            updateWeekHeaderLabels();
            alert('Schedule imported successfully.');
        } catch (err) {
            alert('Failed to import schedule: ' + err.message);
        }
    };
    reader.readAsText(file);
}

function wipeSchedule() {
    if (!confirm('Are you sure you want to wipe the entire schedule?')) return;
    schedule = [];
    prioTop3.value = '';
    prioOther.value = '';
    prioIdeas.value = '';
    saveSchedule();
    renderTable();
}

// ── Theme ─────────────────────────────────────────────────────

function switchTheme(mode) {
    document.body.classList.remove('light-mode', 'demure-mode');
    if (mode === 'light') document.body.classList.add('light-mode');
    else if (mode === 'demure') document.body.classList.add('demure-mode');
    currentTheme = mode;

    document.querySelectorAll('.mode-switcher').forEach(btn => btn.classList.remove('active-mode'));
    const activeBtn = { light: lightModeButton, dark: darkModeButton, demure: demureModeButton }[mode];
    if (activeBtn) activeBtn.classList.add('active-mode');

    populateColorOptions();
    renderSchedule();
    saveSchedule();
}

// ── Current time line ─────────────────────────────────────────

function updateCurrentTimeLine() {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const scheduleStart = timeToMinutes(startTimeInput.value);
    const scheduleEnd = timeToMinutes(endTimeInput.value);

    if (currentMinutes < scheduleStart || currentMinutes > scheduleEnd) {
        currentTimeLine.style.display = 'none';
        return;
    }

    currentTimeLine.style.display = 'block';
    const cellHeight = getCellHeight();
    const headerHeight = document.querySelector('.table thead').offsetHeight;
    const topPx = ((currentMinutes - scheduleStart) / TIME_SLOT_INTERVAL) * cellHeight + headerHeight;
    currentTimeLine.style.top = `${topPx}px`;

    // Align left edge with the Monday column
    const thMon = document.getElementById('thMonday');
    if (thMon) {
        const containerRect = timetableContainer.getBoundingClientRect();
        currentTimeLine.style.left = `${thMon.getBoundingClientRect().left - containerRect.left}px`;
        currentTimeLine.style.right = '0';
    }
}

// ── Resize ────────────────────────────────────────────────────

function addResizeListeners(blockDiv, block) {
    const topHandle = blockDiv.querySelector('.resize-handle.top');
    const bottomHandle = blockDiv.querySelector('.resize-handle.bottom');

    let isResizing = false;
    let resizeType = null;
    let startY = 0;
    let originalStart = 0;
    let originalEnd = 0;

    function startResize(e, type) {
        e.stopPropagation();
        isResizing = true;
        resizeType = type;
        startY = e.clientY;
        originalStart = timeToMinutes(block.start);
        originalEnd = timeToMinutes(block.end);
        document.body.classList.add('resizing');
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    topHandle.addEventListener('mousedown', e => startResize(e, 'top'));
    bottomHandle.addEventListener('mousedown', e => startResize(e, 'bottom'));

    function onMouseMove(e) {
        if (!isResizing) return;
        const cellHeight = getCellHeight();
        const deltaMinutes = Math.round((e.clientY - startY) / cellHeight * TIME_SLOT_INTERVAL);
        const scheduleStartMin = timeToMinutes(startTimeInput.value);
        const scheduleEndMin = timeToMinutes(endTimeInput.value);
        const headerHeight = document.querySelector('.table thead').offsetHeight;

        let newStart = originalStart;
        let newEnd = originalEnd;

        if (resizeType === 'top') {
            newStart = Math.round((originalStart + deltaMinutes) / TIME_SLOT_INTERVAL) * TIME_SLOT_INTERVAL;
            newStart = Math.max(scheduleStartMin, Math.min(newStart, originalEnd - TIME_SLOT_INTERVAL));
        } else {
            newEnd = Math.round((originalEnd + deltaMinutes) / TIME_SLOT_INTERVAL) * TIME_SLOT_INTERVAL;
            newEnd = Math.min(scheduleEndMin, Math.max(newEnd, originalStart + TIME_SLOT_INTERVAL));
        }

        const newTop = ((newStart - scheduleStartMin) / TIME_SLOT_INTERVAL) * cellHeight + headerHeight;
        const newHeight = ((newEnd - newStart) / TIME_SLOT_INTERVAL) * cellHeight;

        if (resizeType === 'top') blockDiv.style.top = `${newTop}px`;
        blockDiv.style.height = `${newHeight}px`;
    }

    function onMouseUp() {
        if (!isResizing) return;
        isResizing = false;
        document.body.classList.remove('resizing');
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        const cellHeight = getCellHeight();
        const scheduleStartMin = timeToMinutes(startTimeInput.value);
        const headerHeight = document.querySelector('.table thead').offsetHeight;

        let newStart = Math.round(
            (scheduleStartMin + (parseFloat(blockDiv.style.top) - headerHeight) / cellHeight * TIME_SLOT_INTERVAL)
            / TIME_SLOT_INTERVAL
        ) * TIME_SLOT_INTERVAL;

        let newEnd = Math.round(
            (newStart + parseFloat(blockDiv.style.height) / cellHeight * TIME_SLOT_INTERVAL)
            / TIME_SLOT_INTERVAL
        ) * TIME_SLOT_INTERVAL;

        newStart = Math.max(newStart, timeToMinutes(startTimeInput.value));
        newEnd = Math.min(newEnd, timeToMinutes(endTimeInput.value));
        if (newEnd <= newStart) newEnd = newStart + TIME_SLOT_INTERVAL;

        // FIX: use let so we can reassign on conflict
        let newStartTime = minutesToTime(newStart);
        let newEndTime = minutesToTime(newEnd);

        const conflictStart = resizeType === 'top' ? newStartTime : block.start;
        const conflictEnd = resizeType === 'top' ? block.end : newEndTime;

        if (checkConflict(block.day, conflictStart, conflictEnd, block.id)) {
            alert('Resizing causes a conflict with another time block.');
            newStartTime = minutesToTime(originalStart);
            newEndTime = minutesToTime(originalEnd);
        }

        block.start = newStartTime;
        block.end = newEndTime;

        const resizedDuration = timeToMinutes(newEndTime) - timeToMinutes(newStartTime);
        if (resizedDuration <= TIME_SLOT_INTERVAL) {
            block.showTaskName = false;
        } else {
            block.showTaskName = true;
            block.showProjectName = true;
        }

        saveSchedule();
        renderTable();
    }
}

// ── Preset list UI ────────────────────────────────────────────

function renderPresetList() {
    presetList.innerHTML = '';

    if (!projectTaskPresets.length) {
        const empty = document.createElement('div');
        empty.className = 'list-group-item';
        empty.textContent = 'No recently used tasks yet.';
        presetList.appendChild(empty);
        return;
    }

    // Module-level drag state (shared across all group/row listeners in this render)
    let dragSrcType = null;       // 'project' | 'task'
    let dragSrcProjectKey = null;
    let dragSrcFlatIndex = null;  // originalIndex for tasks; irrelevant for projects

    const groups = getGroupedSortedPresets();

    groups.forEach(group => {
        const wrapper = document.createElement('div');
        wrapper.className = 'list-group-item preset-project-group';
        wrapper.dataset.projectKey = group.projectName;

        // ── Project header (drag source + drop target for project reorder) ──
        const header = document.createElement('div');
        header.className = 'project-group-header d-flex align-items-center gap-2';
        header.draggable = true;

        const projectHandle = document.createElement('span');
        projectHandle.className = 'drag-handle';
        projectHandle.innerHTML = '<i class="bi bi-grip-vertical"></i>';
        projectHandle.title = 'Drag to reorder project';

        const projectLabel = document.createElement('span');
        projectLabel.className = 'flex-grow-1';
        projectLabel.textContent = group.projectName || '(No Project Name)';

        header.appendChild(projectHandle);
        header.appendChild(projectLabel);
        wrapper.appendChild(header);

        // dragstart — mark this as a project drag
        header.addEventListener('dragstart', (e) => {
            dragSrcType = 'project';
            dragSrcProjectKey = group.projectName;
            dragSrcFlatIndex = null;
            e.dataTransfer.effectAllowed = 'move';
            // slight delay so the browser snapshot doesn't show the dimmed state
            requestAnimationFrame(() => header.classList.add('dragging-group'));
        });

        header.addEventListener('dragend', () => {
            header.classList.remove('dragging-group');
            document.querySelectorAll('.project-drop-zone').forEach(el => el.classList.remove('drag-over-group'));
            dragSrcType = null;
        });

        // Drop zone sits between groups — a thin bar that appears on hover
        const dropZone = document.createElement('div');
        dropZone.className = 'project-drop-zone';
        dropZone.dataset.targetProjectKey = group.projectName;

        dropZone.addEventListener('dragenter', (e) => {
            if (dragSrcType !== 'project') return;
            if (dragSrcProjectKey === group.projectName) return;
            e.preventDefault();
            dropZone.classList.add('drag-over-group');
        });

        dropZone.addEventListener('dragover', (e) => {
            if (dragSrcType !== 'project') return;
            if (dragSrcProjectKey === group.projectName) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over-group');
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over-group');
            if (dragSrcType !== 'project') return;
            if (dragSrcProjectKey === group.projectName) return;

            const srcName = dragSrcProjectKey;
            const srcItems = projectTaskPresets
                .map((p, i) => ({ p, i }))
                .filter(({ p }) => (p.projectName || '').trim() === srcName);

            // Remove src items back-to-front to keep indices stable
            const removed = [];
            for (let i = srcItems.length - 1; i >= 0; i--) {
                const [item] = projectTaskPresets.splice(srcItems[i].i, 1);
                removed.unshift(item);
            }

            // Insert before the target group's first item
            const insertAt = projectTaskPresets.findIndex(
                p => (p.projectName || '').trim() === group.projectName
            );
            projectTaskPresets.splice(insertAt === -1 ? projectTaskPresets.length : insertAt, 0, ...removed);

            saveSchedule();
            renderPresetList();
        });

        // Prepend the drop zone before the wrapper so dropping "before" a group works
        presetList.appendChild(dropZone);

        // ── Task rows ────────────────────────────────────────
        group.tasks.forEach(taskPreset => {
            const row = document.createElement('div');
            row.className = 'project-task-row d-flex align-items-center gap-2 py-1';
            row.draggable = true;
            row.dataset.originalIndex = taskPreset.originalIndex;
            row.dataset.projectKey = group.projectName;

            const taskHandle = document.createElement('span');
            taskHandle.className = 'drag-handle drag-handle-task';
            taskHandle.innerHTML = '<i class="bi bi-grip-vertical"></i>';
            taskHandle.title = 'Drag to reorder task';

            const fillBtn = document.createElement('button');
            fillBtn.type = 'button';
            fillBtn.className = 'btn btn-sm flex-grow-1 text-start';
            fillBtn.textContent = `${taskPreset.taskName || '(No Task Name)'} (${taskPreset.taskId || 'No Task ID'})`;
            fillBtn.addEventListener('click', () => {
                modalProjectName.value = taskPreset.projectName || '';
                modalTaskName.value = taskPreset.taskName || '';
                modalTaskId.value = taskPreset.taskId || '';
                taskPickerModal.hide();
            });

            const delBtn = document.createElement('button');
            delBtn.type = 'button';
            delBtn.className = 'btn btn-sm';
            delBtn.innerHTML = '<i class="bi bi-x-lg"></i>';
            delBtn.title = 'Delete saved entry';
            delBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteProjectTaskPreset(taskPreset.originalIndex, () => {
                    saveSchedule();
                    renderPresetList();
                });
            });

            row.appendChild(taskHandle);
            row.appendChild(fillBtn);
            if (taskPreset.taskId) {
                const linkBtn = document.createElement('a');
                linkBtn.href = `https://app.clickup.com/t/${taskPreset.taskId}`;
                linkBtn.target = '_blank';
                linkBtn.rel = 'noopener noreferrer';
                linkBtn.className = 'btn btn-sm px-1';
                linkBtn.innerHTML = '<i class="bi bi-box-arrow-up-right" style="font-size:0.7rem;opacity:0.6;"></i>';
                linkBtn.title = 'Open in ClickUp';
                linkBtn.addEventListener('click', e => e.stopPropagation());
                row.appendChild(linkBtn);
            }
            row.appendChild(delBtn);
            wrapper.appendChild(row);

            row.addEventListener('dragstart', (e) => {
                dragSrcType = 'task';
                dragSrcProjectKey = group.projectName;
                dragSrcFlatIndex = taskPreset.originalIndex;
                e.dataTransfer.effectAllowed = 'move';
                e.stopPropagation();
                requestAnimationFrame(() => row.classList.add('dragging-task'));
            });

            row.addEventListener('dragend', () => {
                row.classList.remove('dragging-task');
                document.querySelectorAll('.project-task-row').forEach(el => el.classList.remove('drag-over-task'));
                dragSrcType = null;
            });

            row.addEventListener('dragenter', (e) => {
                if (dragSrcType !== 'task') return;
                if (row.dataset.projectKey !== dragSrcProjectKey) return;
                if (parseInt(row.dataset.originalIndex) === dragSrcFlatIndex) return;
                e.preventDefault();
                e.stopPropagation();
                document.querySelectorAll('.project-task-row').forEach(el => el.classList.remove('drag-over-task'));
                row.classList.add('drag-over-task');
            });

            row.addEventListener('dragover', (e) => {
                if (dragSrcType !== 'task') return;
                if (row.dataset.projectKey !== dragSrcProjectKey) return;
                if (parseInt(row.dataset.originalIndex) === dragSrcFlatIndex) return;
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'move';
            });

            row.addEventListener('dragleave', (e) => {
                if (!row.contains(e.relatedTarget)) {
                    row.classList.remove('drag-over-task');
                }
            });

            row.addEventListener('drop', (e) => {
                e.preventDefault();
                e.stopPropagation();
                row.classList.remove('drag-over-task');
                if (dragSrcType !== 'task') return;
                if (row.dataset.projectKey !== dragSrcProjectKey) return;

                const toIndex = parseInt(row.dataset.originalIndex);
                if (dragSrcFlatIndex === toIndex) return;

                movePreset(dragSrcFlatIndex, toIndex);
                saveSchedule();
                renderPresetList();
            });
        });

        presetList.appendChild(wrapper);
    });

    // Final drop zone after the last group
    const finalDropZone = document.createElement('div');
    finalDropZone.className = 'project-drop-zone project-drop-zone-last';

    finalDropZone.addEventListener('dragenter', (e) => {
        if (dragSrcType !== 'project') return;
        e.preventDefault();
        finalDropZone.classList.add('drag-over-group');
    });

    finalDropZone.addEventListener('dragover', (e) => {
        if (dragSrcType !== 'project') return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    });

    finalDropZone.addEventListener('dragleave', () => {
        finalDropZone.classList.remove('drag-over-group');
    });

    finalDropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        finalDropZone.classList.remove('drag-over-group');
        if (dragSrcType !== 'project') return;

        const srcName = dragSrcProjectKey;
        const srcItems = projectTaskPresets
            .map((p, i) => ({ p, i }))
            .filter(({ p }) => (p.projectName || '').trim() === srcName);

        const removed = [];
        for (let i = srcItems.length - 1; i >= 0; i--) {
            const [item] = projectTaskPresets.splice(srcItems[i].i, 1);
            removed.unshift(item);
        }
        projectTaskPresets.push(...removed);

        saveSchedule();
        renderPresetList();
    });

    presetList.appendChild(finalDropZone);
}

function openTaskPicker() {
    renderPresetList();
    taskPickerModal.show();
    if (isConfigured()) loadCuTasks();
}

// ── Prioritization panel ──────────────────────────────────────

function openPrioPanel() {
    prioritizationPanel.classList.add('open');
    prioritizationPanel.setAttribute('aria-hidden', 'false');
    mainContent.classList.add('shifted');
    prioTop3.focus();
}

function closePrioPanel() {
    prioritizationPanel.classList.remove('open');
    prioritizationPanel.setAttribute('aria-hidden', 'true');
    mainContent.classList.remove('shifted');
}

function handleIndentKey(e) {
    if (e.key !== 'Tab' || !prioTextareas.includes(e.currentTarget)) return;
    e.preventDefault();

    const ta = e.currentTarget;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const value = ta.value;
    const INDENT = '  ';
    const hasShift = e.shiftKey;
    const isMultiLine = value.substring(start, end).includes('\n');

    if (!isMultiLine) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        if (hasShift) {
            if (value.substring(lineStart, lineStart + INDENT.length) === INDENT) {
                ta.value = value.substring(0, lineStart) + value.substring(lineStart + INDENT.length);
                ta.selectionStart = ta.selectionEnd = start - INDENT.length;
            }
        } else {
            ta.value = value.substring(0, lineStart) + INDENT + value.substring(lineStart);
            ta.selectionStart = ta.selectionEnd = start + INDENT.length;
        }
    } else {
        const selLineStart = value.lastIndexOf('\n', start - 1) + 1;
        const selLineEnd = value.indexOf('\n', end);
        const blockEnd = selLineEnd === -1 ? value.length : selLineEnd;
        const lines = value.substring(selLineStart, blockEnd).split('\n');

        const newLines = lines.map(line => {
            if (hasShift) return line.startsWith(INDENT) ? line.substring(INDENT.length) : line;
            return INDENT + line;
        });

        ta.value = value.substring(0, selLineStart) + newLines.join('\n') + value.substring(blockEnd);
        const delta = INDENT.length * (hasShift ? -1 : 1);
        ta.selectionStart = Math.max(selLineStart, start + delta);
        ta.selectionEnd = Math.max(ta.selectionStart, end + delta * lines.length);
    }
}

// ── Notifications toggle ──────────────────────────────────────

async function handleNotificationToggle() {
    notificationsEnabled = notifyToggle.checked;
    if (notificationsEnabled) {
        const granted = await requestNotificationPermission();
        if (!granted) {
            alert('Permission for notifications was denied.');
            notificationsEnabled = false;
            notifyToggle.checked = false;
        }
    }
    saveSchedule();
}

// ── Modal keyboard shortcut ───────────────────────────────────

function handleModalKeyDown(e) {
    if ((e.key === 'Enter' && e.code === 'NumpadEnter') || (e.ctrlKey && e.key === 'Enter')) {
        e.preventDefault();
        acceptButton.click();
    }
}

// ── Event listeners ───────────────────────────────────────────

startTimeInput.addEventListener('change', () => {
    const start = timeToMinutes(startTimeInput.value);
    const end = timeToMinutes(endTimeInput.value);
    if (start >= end) {
        alert('Start time must be before end time.');
        startTimeInput.value = minutesToTime(end - TIME_SLOT_INTERVAL);
    }
    saveSchedule();
    renderTable();
});

endTimeInput.addEventListener('change', () => {
    const start = timeToMinutes(startTimeInput.value);
    const end = timeToMinutes(endTimeInput.value);
    if (end <= start) {
        alert('End time must be after start time.');
        endTimeInput.value = minutesToTime(start + TIME_SLOT_INTERVAL);
    }
    saveSchedule();
    renderTable();
});

weekMondayInput.addEventListener('change', () => {
    if (!weekMondayInput.value) return;
    const monday = startOfWeekMonday(parseISOToLocalDate(weekMondayInput.value));
    weekMondayISO = toISODateLocal(monday);
    weekMondayInput.value = weekMondayISO;
    updateWeekHeaderLabels();
});

exportButton.addEventListener('click', exportSchedule);
importButton.addEventListener('click', () => importFileInput.click());
wipeButton.addEventListener('click', wipeSchedule);

lightModeButton.addEventListener('click', () => switchTheme('light'));
darkModeButton.addEventListener('click', () => switchTheme('dark'));
demureModeButton.addEventListener('click', () => switchTheme('demure'));

acceptButton.addEventListener('click', saveBlock);
deleteButton.addEventListener('click', deleteBlock);
syncCardButton.addEventListener('click', syncCard);
loggedToggleButton.addEventListener('click', toggleLoggedState);
copyTaskIdButton.addEventListener('click', copyTaskId);
copyDescriptionButton.addEventListener('click', copyDescriptionOnly);
copyTotalTimeButton.addEventListener('click', copyTotalTimeForSameTaskSameDay);
openTaskLinkButton.addEventListener('click', openTaskLink);
openPresetListButton.addEventListener('click', openTaskPicker);

prioTextareas.forEach(t => {
    t.addEventListener('input', () => saveSchedule());
    t.addEventListener('keydown', handleIndentKey);
});

prioritizationButton.addEventListener('click', () => {
    prioritizationPanel.classList.contains('open') ? closePrioPanel() : openPrioPanel();
});
closePrioritizationPanel.addEventListener('click', closePrioPanel);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && prioritizationPanel.classList.contains('open')) closePrioPanel();
});

importFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) importSchedule(file);
    importFileInput.value = '';
});

timeBlockModalElement.addEventListener('shown.bs.modal', () => {
    timeBlockModalElement.addEventListener('keydown', handleModalKeyDown);
});
timeBlockModalElement.addEventListener('hidden.bs.modal', () => {
    timeBlockModalElement.removeEventListener('keydown', handleModalKeyDown);
});

timeBlockForm.addEventListener('submit', e => e.preventDefault());
modalProjectName.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); modalTaskName.focus(); }
});

notifyToggle.addEventListener('change', handleNotificationToggle);

clickupSettingsButton.addEventListener('click', () => {
    const isOpen = clickupTokenSection.style.display !== 'none';
    clickupTokenSection.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
        clickupTokenInput.value = getApiToken();
        clickupTokenInput.focus();
    }
});

saveClickupTokenBtn.addEventListener('click', async () => {
    const token = clickupTokenInput.value.trim();
    if (!token) return;

    saveClickupIcon.className = 'bi bi-hourglass-split';
    saveClickupLabel.textContent = 'Connecting...';
    saveClickupTokenBtn.disabled = true;

    try {
        setApiToken(token);
        await initUserAndTeam(token);
        updateClickUpUI();
        cuTasksCache = null;
        clickupTokenSection.style.display = 'none';
    } catch (err) {
        alert(err.message);
    } finally {
        saveClickupIcon.className = 'bi bi-check-lg';
        saveClickupLabel.textContent = 'Save token';
        saveClickupTokenBtn.disabled = false;
    }
});

cuFetchBtn.addEventListener('click', cuFetchFromPreset);
cuFetchInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); cuFetchFromPreset(); } });
cuRefreshBtn.addEventListener('click', () => { cuTasksCache = null; loadCuTasks(true); });
imputarButton.addEventListener('click', imputarHoras);
imputarGranularButton.addEventListener('click', imputarGranular);

document.addEventListener('mouseup', onMouseUpDocument);

window.addEventListener('resize', () => {
    renderSchedule();
    updateCurrentTimeLine();
});

// ── Init ──────────────────────────────────────────────────────

(async function initApp() {
    await loadSchedule();
    populateColorOptions();
    renderTable();
    switchTheme(currentTheme);
    setInterval(updateCurrentTimeLine, 60_000);
    updateCurrentTimeLine();
    updateClickUpUI();
})();
