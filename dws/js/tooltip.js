// ============================================================
// tooltip.js — custom hover tooltip logic
// ============================================================

import { timeToMinutes } from './utils.js';
import { COLOR_THEMES } from './config.js';

const tooltipEl = document.getElementById('customTooltip');
let tooltipTimeout = null;

export function scheduleTooltip(fn, delay = 125) {
    clearTooltipTimeout();
    tooltipTimeout = setTimeout(fn, delay);
}

export function clearTooltipTimeout() {
    clearTimeout(tooltipTimeout);
}

export function hideTooltip() {
    clearTooltipTimeout();
    tooltipEl.style.display = 'none';
    tooltipEl.classList.remove('fade-in');
}

export function showBlockTooltip(block, schedule, currentTheme) {
    const projectName = (block.projectName || '').trim();
    const taskName = (block.taskName || '').trim();
    const taskId = (block.taskId || '').trim();
    const colorName = (block.colorName || '').trim();
    const day = block.day;

    const matches = schedule
        .filter(b =>
            b.day === day &&
            (b.projectName || '').trim() === projectName &&
            (b.taskName || '').trim() === taskName &&
            (b.taskId || '').trim() === taskId &&
            (b.colorName || '').trim() === colorName
        )
        .slice()
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    const blocksToShow = matches.length ? matches : [block];
    const out = [];

    if (projectName) out.push(`<span class="tt-title">${esc(projectName)}</span>`);
    if (taskName) out.push(`<span>${esc(taskName)}</span>`);
    // "ID" is capitalised here, not by CSS: the id itself must print verbatim.
    if (taskId) out.push(`<span class="tt-meta">ID ${esc(taskId)}</span>`);

    if (block.description) {
        out.push('<span class="tt-rule"></span>');
        out.push(`<span class="tt-desc">${esc(block.description).replace(/\n/g, '<br>')}</span>`);
    }

    // One row per slice of the day, duration right-aligned (TUI table rule).
    out.push('<span class="tt-rule"></span>');
    let grandTotalMinutes = 0;
    blocksToShow.forEach(b => {
        const dur = Math.max(0, timeToMinutes(b.end) - timeToMinutes(b.start));
        grandTotalMinutes += dur;
        out.push(row(`${b.start}–${b.end}`, fmtHours(dur)));
    });

    out.push('<span class="tt-rule"></span>');
    out.push(row('total', fmtHours(grandTotalMinutes), true));

    tooltipEl.innerHTML = out.join('');
    tooltipEl.style.borderLeftColor = COLOR_THEMES[currentTheme][colorName] || 'var(--fg-mute)';
    _showTooltip();
}

// ── Small formatting helpers ─────────────────────────────────────

function esc(str) {
    return String(str).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function fmtHours(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function row(left, right, isTotal = false) {
    return `<span class="tt-row${isTotal ? ' tt-total' : ''}">`
         + `<span>${esc(left)}</span><span>${esc(right)}</span></span>`;
}

export function showDayTooltip(day, schedule) {
    const dayBlocks = schedule
        .filter(b => b.day === day)
        .slice()
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    const out = [`<span class="tt-title">${esc(day)}</span>`, '<span class="tt-rule"></span>'];

    if (dayBlocks.length === 0) {
        out.push('<span class="tt-meta">no tasks</span>');
        out.push('<span class="tt-rule"></span>');
        out.push(row('total', '0h', true));
    } else {
        const groupedTasks = new Map();
        let totalMinutesAll = 0;

        dayBlocks.forEach(block => {
            const dur = Math.max(0, timeToMinutes(block.end) - timeToMinutes(block.start));
            totalMinutesAll += dur;

            const key = `${(block.projectName || '').trim()}|||${(block.taskName || '').trim()}|||${(block.colorName || '').trim()}`;
            if (!groupedTasks.has(key)) {
                const title = [(block.projectName || '').trim(), (block.taskName || '').trim()]
                    .filter(Boolean).join(' · ') || 'untitled';
                groupedTasks.set(key, { title, totalMinutes: 0 });
            }
            groupedTasks.get(key).totalMinutes += dur;
        });

        groupedTasks.forEach(task => out.push(row(task.title, fmtHours(task.totalMinutes))));

        out.push('<span class="tt-rule"></span>');
        out.push(row('total', fmtHours(totalMinutesAll), true));
    }

    tooltipEl.innerHTML = out.join('');
    tooltipEl.style.borderLeftColor = 'var(--fg-mute)';
    _showTooltip();
}

function _showTooltip() {
    // Position is owned by the stylesheet (it has to clear the status bar).
    tooltipEl.classList.add('fade-in');
    tooltipEl.style.display = 'block';
}
