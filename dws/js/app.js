// ============================================================
// app.js — main application logic
// ============================================================

import { DAYS, TIME_SLOT_INTERVAL, COLOR_THEMES, AVAILABLE_COLORS, COLOR_DISPLAY_NAMES } from './config.js';
import { getAppState, saveAppState } from './db.js';
import {
    getApiToken, setApiToken, getSavedUser, initUserAndTeam,
    isConfigured, fetchTask, fetchAssignedTasks, registerTime, extractTaskId,
    getTimeEntries, deleteTimeEntry, fetchTaskDescription,
    fetchListStatuses, updateTaskStatus
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
const WEEKS_TO_KEEP = 9; // current week + 8 previous ≈ 2 months

let weeks = {};      // { mondayISO: [blocks] } — all stored weeks
let schedule = [];   // blocks of the currently displayed week (weeks[weekMondayISO])
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
const statusesByList = new Map();
let modalStatusLoadToken = 0;

// Drag state
let draggedBlock = null;
let dragStartOffsetMinutes = 0;
let isCopyDrag = false;
let dragGhostEl = null;
let dragSourceEl = null;
let dragPendingDay = null;
let dragPendingStart = null;
let dragPendingEnd = null;
let dragCandidateBlock = null;
let dragCandidateEl = null;
let dragCandidateShift = false;
let dragCandidateOffsetMinutes = 0;
let dragMouseDownX = 0;
let dragMouseDownY = 0;
let dragInitiated = false;
let dragEndTime = 0;
let dragLastEvent = null;  // last mousemove, reused by the auto-scroll loop
let dragScrollRAF = null;  // rAF id of the edge auto-scroll loop

// A block that starts on the very first row sits flush against the
// day-header divider (both land on the same sub-pixel row → the card's
// color bleeds into the white line). Nudge only those blocks down a few
// px so the header line stays crisp; every other block stays flush.
const TOP_ROW_GAP = 3;

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
const prevWeekBtn = document.getElementById('prevWeekBtn');
const nextWeekBtn = document.getElementById('nextWeekBtn');
const weekLabel = document.getElementById('weekLabel');
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
const logTodayButton = document.getElementById('logTodayButton');
const logTodayIcon = document.getElementById('logTodayIcon');
const logTodayLabel = document.getElementById('logTodayLabel');

const timeBlockModalElement = document.getElementById('timeBlockModal');
const timeBlockModal = new bootstrap.Modal(timeBlockModalElement);
const timeBlockForm = document.getElementById('timeBlockForm');
const modalStartTime = document.getElementById('modalStartTime');
const modalEndTime = document.getElementById('modalEndTime');
const modalProjectName = document.getElementById('modalProjectName');
const modalTaskName = document.getElementById('modalTaskName');
const modalTaskId = document.getElementById('modalTaskId');
const modalDescription = document.getElementById('modalDescription');
const modalColor       = document.getElementById('modalColor');
const modalColorBtn    = document.getElementById('modalColorBtn');
const modalColorMenu   = document.getElementById('modalColorMenu');
const modalColorDropdown = modalColorBtn.parentElement;
const modalColorSquare = modalColorBtn.querySelector('.status-dot');
const modalColorText   = modalColorBtn.querySelector('.status-text');
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
const modeUser               = document.getElementById('modeUser');
const modeUserName           = document.getElementById('modeUserName');

const cuFetchRow     = document.getElementById('cuFetchRow');
const cuFetchInput   = document.getElementById('cuFetchInput');
const cuFetchBtn     = document.getElementById('cuFetchBtn');
const cuFetchIcon    = document.getElementById('cuFetchIcon');
const cuTasksSection = document.getElementById('cuTasksSection');
const cuTasksLoading = document.getElementById('cuTasksLoading');
const cuTasksList    = document.getElementById('cuTasksList');
const cuRefreshBtn   = document.getElementById('cuRefreshBtn');

const imputarRow             = document.getElementById('imputarRow');
const updateStatusButton     = document.getElementById('updateStatusButton');
const updateStatusIcon       = document.getElementById('updateStatusIcon');
const updateStatusLabel      = document.getElementById('updateStatusLabel');
const imputarGranularButton  = document.getElementById('imputarGranularButton');
const imputarGranularIcon    = document.getElementById('imputarGranularIcon');
const imputarGranularLabel   = document.getElementById('imputarGranularLabel');

const modalStatusRow  = document.getElementById('modalStatusRow');
const modalStatus     = document.getElementById('modalStatus');
const modalStatusMenu = document.getElementById('modalStatusMenu');
const modalStatusDropdown = modalStatus.parentElement;
const modalStatusDot      = modalStatus.querySelector('.status-dot');
const modalStatusText     = modalStatus.querySelector('.status-text');

let modalStatusValue = '';

function setModalStatus(name, color) {
    modalStatusValue = name || '';
    modalStatusText.textContent = name || '';
    modalStatusDot.style.background = color || 'transparent';
    modalStatusMenu.querySelectorAll('li').forEach(li => {
        li.classList.toggle('selected', li.dataset.value === name);
    });
}

modalStatus.addEventListener('click', e => {
    e.stopPropagation();
    modalStatusDropdown.classList.toggle('open');
});
document.addEventListener('click', e => {
    if (!modalStatusDropdown.contains(e.target)) {
        modalStatusDropdown.classList.remove('open');
    }
});

const notifyToggle = document.getElementById('notifyToggle');

const prioritizationButton = document.getElementById('prioritizationButton');
const prioritizationPanel = document.getElementById('prioritizationPanel');
const closePrioritizationPanel = document.getElementById('closePrioritizationPanel');
const mainContent = document.getElementById('mainContent');

const prioTop3 = document.getElementById('prioTop3');
const prioOther = document.getElementById('prioOther');
const prioIdeas = document.getElementById('prioIdeas');
const prioTextareas = [prioTop3, prioOther, prioIdeas];

// ── Week helpers ─────────────────────────────────────────────

function currentWeekMondayISO() {
    return toISODateLocal(startOfWeekMonday(new Date()));
}

function oldestAllowedMondayISO() {
    const currentMonday = parseISOToLocalDate(currentWeekMondayISO());
    return toISODateLocal(addDays(currentMonday, -7 * (WEEKS_TO_KEEP - 1)));
}

// Rolling retention: as each new week starts, the weeks that fall out of the
// window are dropped one by one (ISO date strings compare lexicographically).
function pruneOldWeeks() {
    const cutoff = oldestAllowedMondayISO();
    Object.keys(weeks).forEach(iso => {
        if (iso < cutoff) delete weeks[iso];
    });
}

function formatEuroDate(dateObj) {
    return `${dateObj.getDate()}/${dateObj.getMonth() + 1}/${dateObj.getFullYear()}`;
}

// ── Persistence ──────────────────────────────────────────────

async function saveSchedule() {
    weeks[weekMondayISO] = schedule;
    pruneOldWeeks();
    const data = {
        weeks,
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
    scheduleNextNotification(weeks[currentWeekMondayISO()] || [], notificationsEnabled);
}

function migrateBlockFields(blocks) {
    blocks.forEach(block => {
        if (block.taskName === undefined) block.taskName = '';
        if (block.taskId === undefined) block.taskId = '';
        if (block.description === undefined) block.description = '';
        if (block.logged === undefined) block.logged = false;
    });
}

async function loadSchedule() {
    try {
        const data = await getAppState();
        if (data) {
            if (data.weeks && typeof data.weeks === 'object') {
                weeks = data.weeks;
            } else if (Array.isArray(data.schedule) && data.schedule.length) {
                // Migrate legacy single-week format into the current week
                weeks = { [currentWeekMondayISO()]: data.schedule };
            } else {
                weeks = {};
            }
            setPresets(data.projectTaskPresets || []);
            startTimeInput.value = data.startTime || '08:00';
            endTimeInput.value = data.endTime || '18:00';
            currentTheme = 'dark';
            notificationsEnabled = data.notificationsEnabled || false;

            Object.values(weeks).forEach(migrateBlockFields);

            const prio = data.prioritization || {};
            prioTop3.value = prio.top3 || '';
            prioOther.value = prio.other || '';
            prioIdeas.value = prio.ideas || '';
        } else {
            weeks = {};
            currentTheme = 'dark';
            notificationsEnabled = false;
        }

        // Always snap to current week's Monday on load
        weekMondayISO = currentWeekMondayISO();
        pruneOldWeeks();
        schedule = weeks[weekMondayISO] || (weeks[weekMondayISO] = []);

        notifyToggle.checked = notificationsEnabled;

        if (notificationsEnabled) {
            const granted = await requestNotificationPermission();
            if (!granted) {
                notificationsEnabled = false;
                notifyToggle.checked = false;
                await saveSchedule();
            }
        }

        updateWeekNav();
        updateWeekHeaderLabels();
    } catch (err) {
        console.error('Failed to load state:', err);
        weeks = {};
        schedule = [];
        weekMondayISO = currentWeekMondayISO();
        weeks[weekMondayISO] = schedule;
        currentTheme = 'dark';
        notificationsEnabled = false;
        updateWeekNav();
        updateWeekHeaderLabels();
    }
}

// ── Week navigation ───────────────────────────────────────────

function updateWeekNav() {
    const monday = parseISOToLocalDate(weekMondayISO);
    weekLabel.textContent = formatEuroDate(monday);
    nextWeekBtn.disabled = weekMondayISO >= currentWeekMondayISO();
    prevWeekBtn.disabled = weekMondayISO <= oldestAllowedMondayISO();
}

function switchToWeek(mondayISO) {
    if (mondayISO === weekMondayISO) return;
    weeks[weekMondayISO] = schedule;
    weekMondayISO = mondayISO;
    schedule = weeks[mondayISO] || (weeks[mondayISO] = []);
    updateWeekNav();
    renderTable();
    saveSchedule();
}

function shiftWeek(deltaWeeks) {
    const target = toISODateLocal(addDays(parseISOToLocalDate(weekMondayISO), deltaWeeks * 7));
    if (target > currentWeekMondayISO()) return;   // cannot advance past the current week
    if (target < oldestAllowedMondayISO()) return; // cannot go past the retention window
    switchToWeek(target);
}

// Clone the previous week's blocks into the displayed week. Blocks that would
// overlap something already placed this week are skipped; copies start unlogged.
function copyLastWeek() {
    const prevISO = toISODateLocal(addDays(parseISOToLocalDate(weekMondayISO), -7));
    const sourceBlocks = weeks[prevISO] || [];
    if (!sourceBlocks.length) {
        alert(`Previous week (${formatEuroDate(parseISOToLocalDate(prevISO))}) has no blocks to copy.`);
        return;
    }

    let nextId = Date.now();
    let copied = 0;
    let skipped = 0;
    sourceBlocks.forEach(block => {
        if (checkConflict(block.day, block.start, block.end)) {
            skipped++;
            return;
        }
        schedule.push({ ...block, id: nextId++, logged: false });
        copied++;
    });

    if (!copied) {
        alert('Nothing copied — every block overlaps an existing block this week.');
        return;
    }

    saveSchedule();
    renderTable();
    if (skipped) alert(`Copied ${copied} block(s). Skipped ${skipped} that overlapped existing blocks.`);
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
    modalColorMenu.innerHTML = '';
    AVAILABLE_COLORS.forEach(colorKey => {
        const hex = COLOR_THEMES[currentTheme][colorKey];
        const label = COLOR_DISPLAY_NAMES[colorKey] || colorKey;
        const li = document.createElement('li');
        li.dataset.value = colorKey;
        li.innerHTML = `<span class="status-dot color-square"></span><span>${label}</span>`;
        li.querySelector('.status-dot').style.background = hex;
        li.addEventListener('click', e => {
            e.stopPropagation();
            modalColor.value = colorKey;
            syncModalColorUI();
            modalColorDropdown.classList.remove('open');
        });
        modalColorMenu.appendChild(li);
    });
    syncModalColorUI();
}

function syncModalColorUI() {
    const key = modalColor.value;
    const hex = key ? COLOR_THEMES[currentTheme][key] : null;
    const label = key ? (COLOR_DISPLAY_NAMES[key] || key) : '';
    modalColorSquare.style.background = hex || 'transparent';
    modalColorText.textContent = label;
    modalColorMenu.querySelectorAll('li').forEach(li => {
        li.classList.toggle('selected', li.dataset.value === key);
    });
}

modalColorBtn.addEventListener('click', e => {
    e.stopPropagation();
    modalColorDropdown.classList.toggle('open');
});
document.addEventListener('click', e => {
    if (!modalColorDropdown.contains(e.target)) {
        modalColorDropdown.classList.remove('open');
    }
});

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
    const isCurrentWeek = weekMondayISO === currentWeekMondayISO();
    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const todayIndex = isCurrentWeek ? DAYS.indexOf(today) : -1; // -1 if not a weekday or viewing a past week

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
        th.classList.toggle('current-day', todayIndex >= 0 && i === todayIndex + 1);
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
/**
 * Exact distance from the container top to the first data row (tbody top).
 * thead.offsetHeight rounds to an integer and misses the half-pixel of the
 * collapsed table border, which made cards overlap the day-header bar
 * (worse under browser zoom, where the fraction grows).
 */
function getHeaderOffset() {
    if (!timetableBody.firstChild) return document.querySelector('.table thead').offsetHeight;
    return timetableBody.getBoundingClientRect().top - timetableContainer.getBoundingClientRect().top;
}

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
    const headerHeight = getHeaderOffset();
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

        // first-row blocks get nudged down so they don't sit on the header line
        const topGap = adjStart <= scheduleStart ? TOP_ROW_GAP : 0;
        const topPx = ((adjStart - scheduleStart) / TIME_SLOT_INTERVAL) * cellHeight + headerHeight + topGap;
        const heightPx = ((adjEnd - adjStart) / TIME_SLOT_INTERVAL) * cellHeight - topGap;
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

        // Description button (top-right, only when task has a ClickUp ID)
        if (block.taskId) {
            const descBtn = document.createElement('button');
            descBtn.className = 'desc-btn';
            descBtn.title = 'View ClickUp description';
            descBtn.innerHTML = '<i class="bi bi-card-text"></i>';
            descBtn.addEventListener('mousedown', e => e.stopPropagation());
            descBtn.addEventListener('click', e => { e.stopPropagation(); openDescPanel(block); });
            blockDiv.appendChild(descBtn);
        }

        // Drag
        blockDiv.addEventListener('mousedown', (e) => {
            if (e.target.classList.contains('resize-handle')) return;
            e.preventDefault();
            dragCandidateBlock = block;
            dragCandidateEl = blockDiv;
            dragCandidateShift = e.shiftKey;
            dragInitiated = false;
            dragMouseDownX = e.clientX;
            dragMouseDownY = e.clientY;
            // floor (not round): the grab point must map to the slot it is
            // actually inside, or the block jumps a slot when the drag starts
            const clickOffsetPx = e.clientY - timetableContainer.getBoundingClientRect().top - parseFloat(blockDiv.style.top);
            const offsetSlots = Math.floor(clickOffsetPx / getCellHeight());
            dragCandidateOffsetMinutes = -Math.max(0, offsetSlots * TIME_SLOT_INTERVAL);
            document.addEventListener('mousemove', onDragMouseMove);
            document.addEventListener('mouseup', onDragEnd);
            document.addEventListener('keydown', onDragKeyDown);
        });

        // Click → edit (suppressed if a drag just ended)
        blockDiv.addEventListener('click', (e) => {
            e.stopPropagation();
            if (Date.now() - dragEndTime < 300) return;
            openModal(block);
        });

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
    if (!dragCandidateBlock) return;

    if (!dragInitiated) {
        const dx = e.clientX - dragMouseDownX;
        const dy = e.clientY - dragMouseDownY;
        if (dx * dx + dy * dy < 25) return; // 5px threshold before drag starts

        draggedBlock = dragCandidateBlock;
        dragSourceEl = dragCandidateEl;
        isCopyDrag = dragCandidateShift;
        dragStartOffsetMinutes = dragCandidateOffsetMinutes;
        dragInitiated = true;
        document.body.classList.add('dragging');

        dragGhostEl = document.createElement('div');
        dragGhostEl.className = 'time-block drag-ghost';
        dragGhostEl.style.cssText = dragCandidateEl.style.cssText;
        dragGhostEl.style.pointerEvents = 'none';
        timetableContainer.appendChild(dragGhostEl);
        dragCandidateEl.classList.add('dragging-source');
        startDragAutoScroll();
    }

    dragLastEvent = e;
    positionDragGhost(e);
}

/**
 * Compute the drop position for the pointer and move the ghost there.
 * The block keeps its full duration: it is slid within the free gap under
 * the pointer (never truncated). If the gap is too small — or the pointer
 * is over another block or outside the grid — the drop is marked invalid.
 */
function positionDragGhost(e) {
    const containerRect = timetableContainer.getBoundingClientRect();
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;

    const cellHeight = getCellHeight();
    const headerHeight = getHeaderOffset();
    const scheduleStart = timeToMinutes(startTimeInput.value);
    const scheduleEnd = timeToMinutes(endTimeInput.value);
    const dayRects = getDayColumnRects();

    let dayIndex = -1;
    for (let i = 0; i < dayRects.length; i++) {
        const { leftPx, widthPx } = dayRects[i];
        if (mouseX >= leftPx && mouseX < leftPx + widthPx) { dayIndex = i; break; }
    }

    if (dayIndex === -1) { hideDragGhost(); return; }

    const slotIndex = Math.floor((mouseY - headerHeight) / cellHeight);
    const cellTime = scheduleStart + slotIndex * TIME_SLOT_INTERVAL;
    // pointer anchor clamped into the visible range
    const pointerTime = Math.max(scheduleStart, Math.min(cellTime, scheduleEnd - TIME_SLOT_INTERVAL));

    const day = DAYS[dayIndex];
    const duration = timeToMinutes(draggedBlock.end) - timeToMinutes(draggedBlock.start);
    const ignoreId = isCopyDrag ? null : draggedBlock.id;

    const gap = getFreeGapAt(day, pointerTime, ignoreId, scheduleStart, scheduleEnd);
    if (!gap || gap.end - gap.start < duration) { hideDragGhost(); return; }

    const desiredStart = cellTime + dragStartOffsetMinutes;
    const startMinutes = Math.max(gap.start, Math.min(desiredStart, gap.end - duration));
    const endMinutes = startMinutes + duration;

    dragPendingDay = day;
    dragPendingStart = startMinutes;
    dragPendingEnd = endMinutes;

    const topGap = startMinutes <= scheduleStart ? TOP_ROW_GAP : 0;
    const topPx = ((startMinutes - scheduleStart) / TIME_SLOT_INTERVAL) * cellHeight + headerHeight + topGap;
    const heightPx = (duration / TIME_SLOT_INTERVAL) * cellHeight - topGap;
    const { leftPx, widthPx } = dayRects[dayIndex];

    dragGhostEl.style.opacity = '';
    dragGhostEl.style.top = `${topPx}px`;
    dragGhostEl.style.left = `${leftPx}px`;
    dragGhostEl.style.width = `${widthPx}px`;
    dragGhostEl.style.height = `${heightPx}px`;
}

function hideDragGhost() {
    dragPendingDay = null;
    if (dragGhostEl) dragGhostEl.style.opacity = '0';
}

// Keep scrolling while the pointer sits near the viewport edge mid-drag
// (mousemove alone stops firing when the mouse is stationary).
function startDragAutoScroll() {
    if (dragScrollRAF) return;
    const step = () => {
        if (!dragInitiated) { dragScrollRAF = null; return; }
        if (dragLastEvent) {
            const margin = 70, speed = 14;
            const y = dragLastEvent.clientY;
            let dy = 0;
            if (y < margin) dy = -speed;
            else if (y > window.innerHeight - margin) dy = speed;
            if (dy) {
                window.scrollBy(0, dy);
                positionDragGhost(dragLastEvent);
            }
        }
        dragScrollRAF = requestAnimationFrame(step);
    };
    dragScrollRAF = requestAnimationFrame(step);
}

function stopDragAutoScroll() {
    if (dragScrollRAF) { cancelAnimationFrame(dragScrollRAF); dragScrollRAF = null; }
    dragLastEvent = null;
}

function onDragKeyDown(e) {
    if (e.key !== 'Escape') return;
    dragPendingDay = null; // discard the pending drop
    onDragEnd();
}

function onDragEnd() {
    document.removeEventListener('mousemove', onDragMouseMove);
    document.removeEventListener('mouseup', onDragEnd);
    document.removeEventListener('keydown', onDragKeyDown);

    if (dragInitiated) {
        document.body.classList.remove('dragging');
        stopDragAutoScroll();
        if (dragGhostEl) { dragGhostEl.remove(); dragGhostEl = null; }
        if (dragSourceEl) { dragSourceEl.classList.remove('dragging-source'); dragSourceEl = null; }

        if (draggedBlock && dragPendingDay !== null) {
            // copies start unlogged, same as Copy Last Week
            const newBlock = isCopyDrag ? { ...draggedBlock, id: Date.now(), logged: false } : draggedBlock;
            newBlock.day = dragPendingDay;
            newBlock.start = minutesToTime(dragPendingStart);
            newBlock.end = minutesToTime(dragPendingEnd);
            if (isCopyDrag) schedule.push(newBlock);
            saveSchedule();
            renderSchedule();
        }

        dragEndTime = Date.now();
    }

    dragCandidateBlock = null;
    dragCandidateEl = null;
    dragInitiated = false;
    draggedBlock = null;
    dragPendingDay = null;
    dragPendingStart = null;
    dragPendingEnd = null;
}

/**
 * Free interval [start, end) around `minute` on `day`, bounded by the
 * visible schedule range. Returns null when `minute` falls inside an
 * existing block (excluding `ignoreId`).
 */
function getFreeGapAt(day, minute, ignoreId, rangeStart, rangeEnd) {
    let gapStart = rangeStart;
    let gapEnd = rangeEnd;
    for (const b of schedule) {
        if (b.day !== day || b.id === ignoreId) continue;
        const s = timeToMinutes(b.start);
        const e = timeToMinutes(b.end);
        if (minute >= s && minute < e) return null; // pointer over a block
        if (e <= minute) gapStart = Math.max(gapStart, e);
        else gapEnd = Math.min(gapEnd, s);
    }
    return { start: gapStart, end: gapEnd };
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
        syncModalColorUI();
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
        syncModalColorUI();
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
    updateStatusIcon.className = 'bi bi-flag';
    updateStatusLabel.textContent = 'Update Status';
    updateStatusButton.disabled = false;
    imputarGranularIcon.className = 'bi bi-card-checklist';
    imputarGranularLabel.textContent = 'Granular Log';
    imputarGranularButton.disabled = false;

    loadTaskStatus(block);

    timeBlockModal.show();
}

async function loadTaskStatus(block) {
    const reqToken = ++modalStatusLoadToken;
    modalStatusMenu.innerHTML = '';
    modalStatusDropdown.classList.remove('open');

    const configured = isConfigured() && !!block?.taskId;
    modalStatusRow.style.display = configured ? '' : 'none';
    setModalStatus('-', null);
    modalStatus.disabled = true;

    if (!configured) return;

    try {
        const task = await fetchTask(block.taskId, getApiToken());
        if (reqToken !== modalStatusLoadToken) return;

        const listId = task.list?.id;
        if (!listId) { setModalStatus('-', null); return; }

        let statuses = statusesByList.get(listId);
        if (!statuses) {
            statuses = await fetchListStatuses(listId, getApiToken());
            if (reqToken !== modalStatusLoadToken) return;
            statusesByList.set(listId, statuses);
        }
        if (!statuses.length) { setModalStatus('-', null); return; }

        modalStatusMenu.innerHTML = '';
        statuses.forEach(s => {
            const li = document.createElement('li');
            li.dataset.value = s.status;
            li.dataset.color = s.color || '';
            li.innerHTML = `<span class="status-dot"></span><span>${s.status}</span>`;
            li.querySelector('.status-dot').style.background = s.color || 'transparent';
            li.addEventListener('click', e => {
                e.stopPropagation();
                setModalStatus(s.status, s.color);
                modalStatusDropdown.classList.remove('open');
            });
            modalStatusMenu.appendChild(li);
        });

        const current = task.status?.status;
        const currentColor = task.status?.color || statuses.find(s => s.status === current)?.color;
        setModalStatus(current || '-', currentColor);
        modalStatus.disabled = false;
    } catch (err) {
        console.warn('Could not load task status:', err);
        setModalStatus('-', null);
    }
}

async function applySelectedStatus(taskId) {
    if (!modalStatusValue || modalStatusValue === '-' || modalStatusRow.style.display === 'none') return;
    try {
        await updateTaskStatus(taskId, modalStatusValue, getApiToken());
    } catch (err) {
        console.warn('Could not update task status:', err);
    }
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
        modeUserName.textContent = user.userName;
        modeUser.style.display = '';
    } else {
        clickupSettingsButton.innerHTML = '<i class="bi bi-plug"></i> ClickUp';
        clickupConnectedInfo.style.display = 'none';
        modeUserName.textContent = '';
        modeUser.style.display = 'none';
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

async function clearDayEntries(token, teamId, taskId, dayDate, userId) {
    const startOfDay = new Date(dayDate); startOfDay.setHours(0, 0, 0, 0);
    const endOfDay   = new Date(dayDate); endOfDay.setHours(23, 59, 59, 999);
    const entries = await getTimeEntries(token, teamId, taskId, startOfDay.getTime(), endOfDay.getTime(), userId);
    await Promise.all(entries.map(e => deleteTimeEntry(token, teamId, e.id)));
}

async function updateStatusOnly() {
    if (!currentEditingBlock?.taskId || !isConfigured()) return;
    if (!modalStatusValue || modalStatusValue === '-') {
        alert('No status selected.');
        return;
    }

    const taskId = currentEditingBlock.taskId.trim();

    updateStatusIcon.className = 'bi bi-hourglass-split';
    updateStatusButton.disabled = true;

    let success = false;
    try {
        await updateTaskStatus(taskId, modalStatusValue, getApiToken());
        success = true;
    } catch (err) {
        alert(err.message);
    } finally {
        if (success) {
            updateStatusIcon.className = 'bi bi-check-circle';
            updateStatusLabel.textContent = 'Updated!';
            setTimeout(() => {
                updateStatusIcon.className = 'bi bi-flag';
                updateStatusLabel.textContent = 'Update Status';
                updateStatusButton.disabled = false;
            }, 2500);
        } else {
            updateStatusIcon.className = 'bi bi-flag';
            updateStatusButton.disabled = false;
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

    await clearDayEntries(getApiToken(), user?.teamId, taskId, baseDate, user?.userId);

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

    if (results.some(r => r.status === 'fulfilled')) {
        await applySelectedStatus(taskId);
    }

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

// ── Log Today ─────────────────────────────────────────────────
// Registers time in ClickUp for every block of today that has both a
// task name and a task ID. Like imputarGranular, each task's entries
// for the day are cleared first, so re-running is safe (idempotent).
async function logToday() {
    if (!isConfigured()) { alert('Connect ClickUp first (settings panel, bottom right).'); return; }
    if (weekMondayISO !== currentWeekMondayISO()) { alert('Switch to the current week to log today.'); return; }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long' });
    const dayIndex = DAYS.indexOf(today);
    if (dayIndex === -1) { alert('Today is not a weekday.'); return; }

    const candidates = schedule.filter(b =>
        b.day === today && (b.taskName || '').trim() && (b.taskId || '').trim()
    );
    if (!candidates.length) { alert('No blocks today with a task and ID assigned.'); return; }

    // Only tasks that still have something unlogged
    const taskIds = [...new Set(
        candidates.filter(b => !b.logged).map(b => b.taskId.trim())
    )];
    if (!taskIds.length) { alert('Everything is already logged for today.'); return; }

    logTodayIcon.className = 'bi bi-hourglass-split';
    logTodayButton.disabled = true;

    const user = getSavedUser();
    const token = getApiToken();
    const baseDate = addDays(parseISOToLocalDate(weekMondayISO), dayIndex);
    const errors = [];
    let loggedCount = 0;

    for (const taskId of taskIds) {
        // re-register ALL of today's blocks for this task (mirrors imputarGranular),
        // since clearDayEntries wipes the whole day for the task
        const blocks = schedule.filter(b =>
            b.day === today && (b.taskId || '').trim() === taskId
        );
        try {
            await clearDayEntries(token, user?.teamId, taskId, baseDate, user?.userId);
        } catch (err) {
            errors.push(`${taskId}: ${err.message || 'could not clear existing entries'}`);
            continue;
        }
        const results = await Promise.allSettled(blocks.map(block => {
            const [h, m] = block.start.split(':').map(Number);
            const d = new Date(baseDate);
            d.setHours(h, m, 0, 0);
            const durationMs = (timeToMinutes(block.end) - timeToMinutes(block.start)) * 60 * 1000;
            return registerTime(token, taskId, user?.teamId, d.getTime(), durationMs, block.description || '', user?.userId);
        }));
        results.forEach((result, i) => {
            if (result.status === 'fulfilled') { blocks[i].logged = true; loggedCount++; }
            else errors.push(`${taskId}: ${result.reason?.message || 'unknown error'}`);
        });
    }

    saveSchedule();
    renderSchedule();

    if (errors.length === 0) {
        logTodayIcon.className = 'bi bi-check-circle';
        logTodayLabel.textContent = `Logged ${loggedCount}!`;
        setTimeout(() => {
            logTodayIcon.className = 'bi bi-calendar-check';
            logTodayLabel.textContent = 'Log Today';
            logTodayButton.disabled = false;
        }, 2500);
    } else {
        alert('Some entries failed:\n' + errors.join('\n'));
        logTodayIcon.className = 'bi bi-calendar-check';
        logTodayLabel.textContent = 'Log Today';
        logTodayButton.disabled = false;
    }
}

// ── Export / Import ───────────────────────────────────────────

function exportSchedule() {
    weeks[weekMondayISO] = schedule;
    const data = {
        weeks,
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
    const weekKeys = Object.keys(weeks).filter(iso => weeks[iso].length).sort();
    const rangeStr = weekKeys.length ? `${weekKeys[0]} to ${weekKeys[weekKeys.length - 1]}` : 'empty';

    a.download = `DWS WEEKS ${rangeStr} - Saved on ${savedDate}_${savedTime}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

function importSchedule(file) {
    const reader = new FileReader();
    reader.onload = async function (e) {
        try {
            const imported = JSON.parse(e.target.result);
            const hasWeeks = imported && imported.weeks && typeof imported.weeks === 'object';
            if (!imported || (!hasWeeks && !Array.isArray(imported.schedule))) throw new Error('Invalid schedule format.');

            if (hasWeeks) {
                weeks = imported.weeks;
            } else {
                // Legacy single-week export: file it under its saved week
                // (or the current week if that week is outside the retention window)
                let targetISO = imported.weekMondayISO || currentWeekMondayISO();
                if (targetISO < oldestAllowedMondayISO() || targetISO > currentWeekMondayISO()) {
                    targetISO = currentWeekMondayISO();
                }
                weeks = { [targetISO]: imported.schedule };
            }
            startTimeInput.value = imported.startTime || '08:00';
            endTimeInput.value = imported.endTime || '18:00';
            currentTheme = 'dark';
            notificationsEnabled = imported.notificationsEnabled || false;
            setPresets(imported.projectTaskPresets || []);

            Object.values(weeks).forEach(migrateBlockFields);

            const prio = imported.prioritization || {};
            prioTop3.value = prio.top3 || '';
            prioOther.value = prio.other || '';
            prioIdeas.value = prio.ideas || '';

            weekMondayISO = currentWeekMondayISO();
            pruneOldWeeks();
            schedule = weeks[weekMondayISO] || (weeks[weekMondayISO] = []);
            updateWeekNav();

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
    if (!confirm('Are you sure you want to wipe the entire schedule (all stored weeks)?')) return;
    weeks = {};
    schedule = [];
    weeks[weekMondayISO] = schedule;
    prioTop3.value = '';
    prioOther.value = '';
    prioIdeas.value = '';
    saveSchedule();
    renderTable();
}

// ── Theme (dark only) ─────────────────────────────────────────

function switchTheme() {
    currentTheme = 'dark';
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

    if (weekMondayISO !== currentWeekMondayISO() || currentMinutes < scheduleStart || currentMinutes > scheduleEnd) {
        currentTimeLine.style.display = 'none';
        return;
    }

    currentTimeLine.style.display = 'block';
    const cellHeight = getCellHeight();
    const headerHeight = getHeaderOffset();
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
        const headerHeight = getHeaderOffset();

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
        const headerHeight = getHeaderOffset();

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

const panelOverlay = document.getElementById('panelOverlay');
panelOverlay.addEventListener('click', () => {
    if (prioritizationPanel.classList.contains('open')) closePrioPanel();
    else closeDescPanel();
});

function openPrioPanel() {
    prioritizationPanel.classList.add('open');
    prioritizationPanel.setAttribute('aria-hidden', 'false');
    mainContent.classList.add('shifted');
    panelOverlay.classList.add('visible');
    prioTop3.focus();
}

function closePrioPanel() {
    prioritizationPanel.classList.remove('open');
    prioritizationPanel.setAttribute('aria-hidden', 'true');
    mainContent.classList.remove('shifted');
    panelOverlay.classList.remove('visible');
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

prevWeekBtn.addEventListener('click', () => shiftWeek(-1));
nextWeekBtn.addEventListener('click', () => shiftWeek(1));
document.getElementById('copyLastWeekButton').addEventListener('click', copyLastWeek);

exportButton.addEventListener('click', exportSchedule);
importButton.addEventListener('click', () => importFileInput.click());
wipeButton.addEventListener('click', wipeSchedule);
logTodayButton.addEventListener('click', logToday);

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

prioritizationButton.addEventListener('click', (e) => {
    e.stopPropagation();
    prioritizationPanel.classList.contains('open') ? closePrioPanel() : openPrioPanel();
});

document.getElementById('printButton').addEventListener('click', () => window.print());

// For print, paint the actual <td> cells covered by each block instead of relying
// on absolutely-positioned overlays — overlays drift when the table reflows for
// the print layout. Cells are part of the table flow, so alignment is guaranteed.
function paintCellsForPrint() {
    const scheduleStart = timeToMinutes(startTimeInput.value || '08:00');
    const scheduleEnd = timeToMinutes(endTimeInput.value || '18:00');

    // Tell the print CSS how many slot rows there are so it can size each row
    // to (page height − header) / count and fill the page exactly once.
    const slotCount = Math.max(1, (scheduleEnd - scheduleStart) / TIME_SLOT_INTERVAL);
    document.documentElement.style.setProperty('--print-row-count', slotCount);

    schedule.forEach(block => {
        const bStart = Math.max(timeToMinutes(block.start), scheduleStart);
        const bEnd = Math.min(timeToMinutes(block.end), scheduleEnd);
        if (bEnd <= bStart) return;

        const colorHex = COLOR_THEMES[currentTheme][block.colorName] || '#000000';
        const label = [block.projectName, block.taskName].filter(Boolean).join(' / ');

        // Put the label on the middle cell so it reads as vertically centered
        // within the whole painted block (each cell has vertical-align: middle).
        const slotsInBlock = (bEnd - bStart) / TIME_SLOT_INTERVAL;
        const labelT = bStart + Math.floor((slotsInBlock - 1) / 2) * TIME_SLOT_INTERVAL;

        for (let t = bStart; t < bEnd; t += TIME_SLOT_INTERVAL) {
            const cell = document.querySelector(
                `td.time-slot[data-day="${block.day}"][data-time="${minutesToTime(t)}"]`
            );
            if (!cell) continue;
            cell.classList.add('print-painted');
            // Pass the task color to CSS — the print stylesheet uses this as a
            // linear-gradient background so the bar sits INSIDE the cell instead
            // of on the border (where it would merge with the neighbor cell).
            cell.style.setProperty('--block-color', colorHex);
            // Mark continuation edges so the print CSS can hide the horizontal
            // gridline between two cells of the SAME task — making the block
            // read as one continuous span instead of N stacked slot rows.
            if (t !== bStart) cell.classList.add('print-cont-top');
            if (t + TIME_SLOT_INTERVAL < bEnd) cell.classList.add('print-cont-bottom');
            if (t === labelT && label) {
                cell.textContent = label;
            }
        }
    });
}

function clearPrintCells() {
    document.querySelectorAll('td.print-painted').forEach(cell => {
        cell.classList.remove('print-painted', 'print-cont-top', 'print-cont-bottom');
        cell.style.removeProperty('--block-color');
        cell.textContent = '';
    });
    document.documentElement.style.removeProperty('--print-row-count');
}

window.addEventListener('beforeprint', paintCellsForPrint);
window.addEventListener('afterprint', clearPrintCells);
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
updateStatusButton.addEventListener('click', updateStatusOnly);
imputarGranularButton.addEventListener('click', imputarGranular);

document.addEventListener('mouseup', onMouseUpDocument);

window.addEventListener('resize', () => {
    renderSchedule();
    updateCurrentTimeLine();
});

// ── Description Panel ────────────────────────────────────────

const descPanel        = document.getElementById('descPanel');
const descPanelProject = document.getElementById('descPanelProject');
const descPanelTask    = document.getElementById('descPanelTask');
const descPanelLoading = document.getElementById('descPanelLoading');
const descPanelContent = document.getElementById('descPanelContent');
const descPanelError   = document.getElementById('descPanelError');
const descRefreshBtn   = document.getElementById('descRefreshBtn');
const descRefreshIcon  = document.getElementById('descRefreshIcon');
const descOpenCuBtn    = document.getElementById('descOpenCuBtn');

let descCurrentBlock = null;
const descCache      = new Map();

function mdInline(text) {
    const e = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return text
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, a, s) => `<img src="${e(s)}" alt="${e(a)}">`)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g,  (_, t, h) => `<a href="${e(h)}">${e(t)}</a>`)
        .replace(/~~([^~\n]+)~~/g,    '<del>$1</del>')
        .replace(/\*\*([^*\n]+)\*\*/g,'<strong>$1</strong>')
        .replace(/__([^_\n]+)__/g,    '<strong>$1</strong>')
        .replace(/\*([^*\n]+)\*/g,    '<em>$1</em>')
        .replace(/_([^_\n]+)_/g,      '<em>$1</em>')
        .replace(/`([^`]+)`/g, (_, c) => `<code>${e(c)}</code>`);
}

function parseMarkdown(src) {
    const e = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = src.split('\n');
    let html = '', inUL = false, inTaskList = false, inCode = false, codeBuf = '';

    const closeList = () => {
        if (inTaskList) { html += '</ul>\n'; inTaskList = false; }
        else if (inUL)  { html += '</ul>\n'; inUL       = false; }
    };

    for (const line of lines) {
        if (line.startsWith('```')) {
            if (inCode) { html += `<pre><code>${e(codeBuf)}</code></pre>\n`; inCode = false; codeBuf = ''; }
            else        { closeList(); inCode = true; }
            continue;
        }
        if (inCode) { codeBuf += line + '\n'; continue; }

        const hm = line.match(/^(#{1,6})\s+(.*)/);
        if (hm) { closeList(); html += `<h${hm[1].length}>${mdInline(hm[2])}</h${hm[1].length}>\n`; continue; }

        if (/^(?:---+|\*\*\*+|___+)\s*$/.test(line)) { closeList(); html += '<hr>\n'; continue; }

        const bq = line.match(/^>\s?(.*)/);
        if (bq) { closeList(); html += `<blockquote><p>${mdInline(bq[1])}</p></blockquote>\n`; continue; }

        // Task list: "- [ ] text" or "- [x] text", with optional leading indent
        const tm = line.match(/^(\s*)[-*]\s+\[([ xX])\]\s+(.*)/);
        if (tm) {
            if (inUL) { html += '</ul>\n'; inUL = false; }
            if (!inTaskList) { html += '<ul class="task-list">\n'; inTaskList = true; }
            const ml = tm[1].length > 0 ? ` style="margin-left:${tm[1].length * 1}px"` : '';
            const checked = tm[2].toLowerCase() === 'x';
            html += `<li class="task-list-item"${ml}><input type="checkbox"${checked ? ' checked' : ''}>${mdInline(tm[3])}</li>\n`;
            continue;
        }

        // Regular list item, with optional leading indent
        const lm = line.match(/^(\s*)[-*]\s+(.*)/);
        if (lm) {
            if (inTaskList) { html += '</ul>\n'; inTaskList = false; }
            if (!inUL) { html += '<ul>\n'; inUL = true; }
            const ml = lm[1].length > 0 ? ` style="margin-left:${lm[1].length * 1}px"` : '';
            html += `<li${ml}>${mdInline(lm[2])}</li>\n`;
            continue;
        }

        if (!line.trim()) { closeList(); html += '<div class="md-spacer"></div>\n'; continue; }

        closeList();
        html += `<p>${mdInline(line)}</p>\n`;
    }

    closeList();
    if (inCode) html += `<pre><code>${e(codeBuf)}</code></pre>\n`;
    return html;
}

function openDescLightbox(src) {
    const lb = document.createElement('div');
    lb.id = 'descLightbox';
    const img = document.createElement('img');
    img.src = src;
    lb.appendChild(img);
    const close = () => lb.remove();
    lb.addEventListener('click', close);
    img.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
    });
    document.body.appendChild(lb);
}

function renderDescMarkdown(markdown) {
    if (!markdown || !markdown.trim()) {
        descPanelContent.innerHTML = '<em style="opacity:0.4">(no description)</em>';
        return;
    }
    descPanelContent.innerHTML = parseMarkdown(markdown);
    descPanelContent.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
    descPanelContent.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        const span = document.createElement('span');
        span.className = 'desc-cb' + (cb.checked ? ' desc-cb-on' : '');
        cb.closest('li')?.classList.add('desc-task-item');
        cb.replaceWith(span);
    });
    descPanelContent.querySelectorAll('img').forEach(img => {
        img.style.cursor = 'zoom-in';
        img.addEventListener('click', () => openDescLightbox(img.src));
    });
}

async function loadDescContent(taskId, force = false) {
    descPanelLoading.style.display = 'block';
    descPanelContent.style.display = 'none';
    descPanelError.style.display   = 'none';
    try {
        let raw;
        if (!force && descCache.has(taskId)) {
            raw = descCache.get(taskId);
        } else {
            const task = await fetchTaskDescription(taskId, getApiToken());
            raw = task.markdown_description || task.description || '';
            descCache.set(taskId, raw);
        }
        descPanelLoading.style.display = 'none';
        descPanelContent.style.display = 'block';
        renderDescMarkdown(raw);
    } catch (err) {
        descPanelLoading.style.display = 'none';
        descPanelError.textContent     = err.message;
        descPanelError.style.display   = 'block';
    }
}

async function openDescPanel(block) {
    descCurrentBlock = block;
    descPanelProject.textContent   = block.projectName || '';
    descPanelTask.textContent      = block.taskName || block.taskId;
    descPanelLoading.style.display = 'block';
    descPanelContent.style.display = 'none';
    descPanelError.style.display   = 'none';
    descPanel.classList.add('open');
    descPanel.setAttribute('aria-hidden', 'false');
    panelOverlay.classList.add('visible');
    if (!getApiToken()) {
        descPanelLoading.style.display = 'none';
        descPanelError.style.display   = 'block';
        descPanelError.textContent     = 'ClickUp not configured — add your API token first.';
        return;
    }
    await loadDescContent(block.taskId);
}

function closeDescPanel() {
    descPanel.classList.remove('open');
    descPanel.setAttribute('aria-hidden', 'true');
    panelOverlay.classList.remove('visible');
    descCurrentBlock = null;
}

document.getElementById('descPanelX').addEventListener('click', closeDescPanel);
document.getElementById('descPanelClose').addEventListener('click', closeDescPanel);


descRefreshBtn.addEventListener('click', async () => {
    if (!descCurrentBlock) return;
    descRefreshIcon.className = 'bi bi-hourglass-split';
    descRefreshBtn.disabled   = true;
    await loadDescContent(descCurrentBlock.taskId, true);
    descRefreshIcon.className = 'bi bi-arrow-repeat';
    descRefreshBtn.disabled   = false;
});

descOpenCuBtn.addEventListener('click', () => {
    if (descCurrentBlock?.taskId)
        window.open(`https://app.clickup.com/t/${descCurrentBlock.taskId}`, '_blank', 'noopener,noreferrer');
});

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && descPanel.classList.contains('open')) closeDescPanel();
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
