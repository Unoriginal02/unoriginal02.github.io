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
    const lines = [];

    if (projectName) lines.push(`<strong>${projectName}</strong>`);
    if (taskName) lines.push(taskName);
    if (taskId) lines.push(`Task ID: ${taskId}`);
    if (block.description) {
        lines.push('');
        lines.push(block.description.replace(/\n/g, '<br>'));
        lines.push('');
    }

    let grandTotalMinutes = 0;
    blocksToShow.forEach(b => {
        const dur = Math.max(0, timeToMinutes(b.end) - timeToMinutes(b.start));
        grandTotalMinutes += dur;
        const hours = parseFloat((dur / 60).toFixed(2));
        lines.push(`${b.start} - ${b.end} <span style="opacity:0.9">(${hours} hours)</span>`);
    });

    const grandTotalHours = parseFloat((grandTotalMinutes / 60).toFixed(2));
    lines.push('');
    lines.push(`<strong>Total: ${grandTotalHours} hours</strong>`);

    tooltipEl.innerHTML = lines.join('<br>');
    tooltipEl.style.borderLeftColor = COLOR_THEMES[currentTheme][colorName] || '#FFFFFF';
    _showTooltip();
}

export function showDayTooltip(day, schedule) {
    const dayBlocks = schedule
        .filter(b => b.day === day)
        .slice()
        .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

    const lines = [`<strong>${day}</strong>`, ''];

    if (dayBlocks.length === 0) {
        lines.push('No tasks', '', '<strong>Hours total: 0</strong>');
    } else {
        const groupedTasks = new Map();
        let totalMinutesAll = 0;

        dayBlocks.forEach(block => {
            const dur = Math.max(0, timeToMinutes(block.end) - timeToMinutes(block.start));
            totalMinutesAll += dur;

            const key = `${(block.projectName || '').trim()}|||${(block.taskName || '').trim()}|||${(block.colorName || '').trim()}`;
            if (!groupedTasks.has(key)) {
                const title = [(block.projectName || '').trim(), (block.taskName || '').trim()]
                    .filter(Boolean).join(' - ') || 'Untitled task';
                groupedTasks.set(key, { title, totalMinutes: 0 });
            }
            groupedTasks.get(key).totalMinutes += dur;
        });

        groupedTasks.forEach(task => {
            lines.push(`${task.title}: ${parseFloat((task.totalMinutes / 60).toFixed(2))}`);
        });

        lines.push('', `<strong>Hours total: ${parseFloat((totalMinutesAll / 60).toFixed(2))}</strong>`);
    }

    tooltipEl.innerHTML = lines.join('<br>');
    tooltipEl.style.borderLeftColor = 'var(--main-color)';
    _showTooltip();
}

function _showTooltip() {
    tooltipEl.style.bottom = '20px';
    tooltipEl.style.left = '20px';
    tooltipEl.classList.add('fade-in');
    tooltipEl.style.display = 'block';
}
