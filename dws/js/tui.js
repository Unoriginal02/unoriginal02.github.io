// ============================================================================
// tui.js — the terminal shell around the app
// ----------------------------------------------------------------------------
// Everything a TUI has that a web page normally does not: a live title bar, a
// bottom status line (mode · counters · message · hints), a `?` keybinding
// overlay, and single-key commands.
//
// It deliberately owns NO application state. Every command is expressed as a
// synthetic click on the control that already implements it, so app.js stays
// the single source of truth for behaviour and this file can never drift out
// of sync with it.
// ============================================================================

const $ = id => document.getElementById(id);

const el = {
    clock:      $('tuiClock'),
    gridNote:   $('tuiGridNote'),
    windowNote: $('tuiWindowNote'),
    schedNote:  $('tuiScheduleNote'),
    mode:       $('tuiMode'),
    weekCell:   $('tuiWeekCell'),
    blockCell:  $('tuiBlockCell'),
    hoursCell:  $('tuiHoursCell'),
    msg:        $('tuiMsg'),
    help:       $('tuiHelp'),

    weekLabel:  $('weekLabel'),
    prevWeek:   $('prevWeekBtn'),
    nextWeek:   $('nextWeekBtn'),
    startTime:  $('startTime'),
    endTime:    $('endTime'),
    timetable:  $('timetable-container'),
    prioPanel:  $('prioritizationPanel'),
    descPanel:  $('descPanel'),
    notify:     $('notifyToggle'),
};

// ── Status line ─────────────────────────────────────────────────

let msgTimer = null;

/**
 * Vim-style one-liner on the status bar. Auto-fades, because a message that
 * outlives the action it describes is worse than no message.
 */
function say(text, kind = '') {
    el.msg.textContent = text;
    el.msg.className = 'sb-msg' + (kind ? ` is-${kind}` : '');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { el.msg.textContent = ''; }, 3200);
}

// Let the rest of the app post to the status line if it ever wants to.
window.dwsStatus = say;

function isTyping() {
    const a = document.activeElement;
    if (!a) return false;
    return a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable;
}

const helpOpen  = () => el.help.classList.contains('open');
const modalOpen = () => !!document.querySelector('.modal.show');
const panelOpen = () => el.prioPanel.classList.contains('open') || el.descPanel.classList.contains('open');

function currentMode() {
    if (helpOpen())  return 'help';
    if (isTyping())  return 'insert';
    if (modalOpen()) return 'dialog';
    if (panelOpen()) return 'panel';
    if (document.body.classList.contains('dragging')) return 'drag';
    return 'normal';
}

function renderMode() {
    // A side panel can be closed while its textarea still holds focus, which
    // would leave us stuck in `insert` with every command key dead. Hand focus
    // back to the page as soon as the panel that owns it is gone.
    const active = document.activeElement;
    if (active && active.closest && active.closest('#prioritizationPanel:not(.open), #descPanel:not(.open)')) {
        active.blur();
    }

    const mode = currentMode();
    if (el.mode.dataset.mode === mode) return;
    el.mode.dataset.mode = mode;
    el.mode.textContent = mode;
}

// ── Counters ────────────────────────────────────────────────────

function fmtHours(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function renderCounters() {
    const blocks = [...el.timetable.querySelectorAll('.time-block:not(.drag-ghost)')];
    const minutes = blocks.reduce((sum, b) => sum + (parseInt(b.dataset.min, 10) || 0), 0);

    el.blockCell.textContent = String(blocks.length);
    el.hoursCell.textContent = fmtHours(minutes);
    el.weekCell.textContent = el.weekLabel.textContent || '—';

    // Panel annotations: the visible window and the day span on screen.
    const [sh, sm] = (el.startTime.value || '08:00').split(':').map(Number);
    const [eh, em] = (el.endTime.value || '18:00').split(':').map(Number);
    const windowMin = Math.max(0, (eh * 60 + em) - (sh * 60 + sm));
    el.windowNote.textContent = `${fmtHours(windowMin)} · ${Math.round(windowMin / 15)} slots`;

    const monday = parseShownMonday();
    el.schedNote.textContent = monday ? `iso week ${isoWeek(monday)}` : '—';
}

/** ISO-8601 week number — the label a work calendar is actually indexed by. */
function isoWeek(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));           // → that week's Thursday
    const firstThursday = new Date(d.getFullYear(), 0, 4);
    firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
    return 1 + Math.round((d - firstThursday) / 604800000);
}

// ── Commands ────────────────────────────────────────────────────

/** Fire a control the app already owns; report what happened. */
function press(node, text, kind) {
    if (!node || node.disabled) { say('unavailable here', 'warn'); return; }
    node.click();
    if (text) say(text, kind);
}

function parseShownMonday() {
    const m = (el.weekLabel.textContent || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

function toggleHelp(force) {
    const open = force === undefined ? !helpOpen() : force;
    el.help.classList.toggle('open', open);
    el.help.setAttribute('aria-hidden', String(!open));
    renderMode();
}

/** Esc / q — peel one layer off, top-most first. */
function closeTopLayer() {
    if (helpOpen())                                { toggleHelp(false); return true; }
    if (el.descPanel.classList.contains('open'))   { $('descPanelClose').click(); return true; }
    if (el.prioPanel.classList.contains('open'))   { $('closePrioritizationPanel').click(); return true; }
    return false;
}

// The key table is deliberately tiny. Bare letters are NOT bound: a stray
// keypress must never be able to wipe a week, fire a bulk log or open a
// dialog. What is left is navigation and dismissal — reversible, view-only,
// and the same keys every TUI uses.
//
//   ← →   previous / next week
//   Esc   close the top-most layer
//   ?     keybindings
//
// Everything else is a click on a labelled control.
const COMMANDS = {
    ArrowLeft:  () => press(el.prevWeek, 'previous week'),
    ArrowRight: () => press(el.nextWeek, 'next week'),
};

document.addEventListener('keydown', e => {
    // `?` and Esc work from anywhere except a text field.
    if (!isTyping()) {
        if (e.key === '?') { e.preventDefault(); toggleHelp(); return; }
        if (e.key === 'Escape') {
            if (closeTopLayer()) { e.preventDefault(); return; }
        }
    }

    if (currentMode() !== 'normal') return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

    const cmd = COMMANDS[e.key];
    if (!cmd) return;
    e.preventDefault();
    cmd();
}, false);

// ── Live bits ───────────────────────────────────────────────────

function tickClock() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    el.clock.textContent = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// The timetable is re-rendered wholesale on every change, so watching its
// child list is enough to keep the counters honest without app.js calling us.
new MutationObserver(renderCounters).observe(el.timetable, { childList: true, subtree: true });

['change', 'input'].forEach(ev => {
    el.startTime.addEventListener(ev, renderCounters);
    el.endTime.addEventListener(ev, renderCounters);
});

document.addEventListener('focusin', renderMode);
document.addEventListener('focusout', () => setTimeout(renderMode, 0));
document.addEventListener('mouseup', () => setTimeout(renderMode, 0));
document.addEventListener('click', () => setTimeout(renderMode, 0));

el.help.addEventListener('click', ev => { if (ev.target === el.help) toggleHelp(false); });

tickClock();
setInterval(tickClock, 1000);
setInterval(renderMode, 400);
renderCounters();
renderMode();
el.gridNote.textContent = '15m';
say('ready — press ? for keybindings');
