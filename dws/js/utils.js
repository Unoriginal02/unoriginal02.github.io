// ============================================================
// utils.js — pure utility / helper functions
// ============================================================

export function timeToMinutes(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
}

export function minutesToTime(minutes) {
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function addMinutes(timeStr, mins) {
    let total = (timeToMinutes(timeStr) + mins) % (24 * 60);
    return minutesToTime(total);
}

export function minutesToHMMh(totalMinutes) {
    const mins = Math.max(0, Math.round(totalMinutes));
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}:${String(m).padStart(2, '0')}h`;
}

export function generateTimeSlots(start, end, interval) {
    const slots = [];
    let current = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    while (current < endMinutes) {
        slots.push(minutesToTime(current));
        current += interval;
    }
    return slots;
}

export function getRandomArrayItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

export function isoTodayLocal() {
    const d = new Date();
    return toISODateLocal(d);
}

export function toISODateLocal(dateObj) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

export function parseISOToLocalDate(isoStr) {
    const [y, m, d] = isoStr.split('-').map(Number);
    return new Date(y, m - 1, d);
}

export function startOfWeekMonday(dateObj) {
    const day = dateObj.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(dateObj);
    monday.setDate(dateObj.getDate() + diffToMonday);
    monday.setHours(0, 0, 0, 0);
    return monday;
}

export function addDays(dateObj, daysToAdd) {
    const d = new Date(dateObj);
    d.setDate(d.getDate() + daysToAdd);
    return d;
}

export function formatDateDMY(dateObj) {
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yyyy = dateObj.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
}

export function alphaCompare(a, b) {
    return (a || '').localeCompare(b || '', undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Read --cell-height and compute the pixel width of a single day column
 * by measuring the actual rendered table cell instead of parsing the CSS calc().
 */
export function getCellHeight() {
    return parseInt(getComputedStyle(document.documentElement).getPropertyValue('--cell-height')) || 24;
}

export function getHoursColumnWidthPct() {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--hours-column-width')) || 10;
}

/**
 * Returns the left-offset percentage for a given day index (0-based).
 * Reads from an actual rendered cell to avoid parsing CSS calc().
 */
export function getDayColumnMetrics(timetableContainer) {
    const firstDataCell = timetableContainer.querySelector('.time-slot');
    if (!firstDataCell) return { hoursColPct: 10, dayColPct: 18 };

    const containerWidth = timetableContainer.offsetWidth;
    const hoursColPct = getHoursColumnWidthPct();
    // Measure actual rendered cell width
    const dayColPx = firstDataCell.offsetWidth;
    const dayColPct = containerWidth > 0 ? (dayColPx / containerWidth) * 100 : 18;
    return { hoursColPct, dayColPct };
}
