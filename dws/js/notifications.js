// ============================================================
// notifications.js — browser notification scheduling
// ============================================================

import { timeToMinutes } from './utils.js';

let notificationTimeout = null;

export function scheduleNextNotification(schedule, notificationsEnabled) {
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
        notificationTimeout = null;
    }

    if (!notificationsEnabled) return;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const today = now.toLocaleDateString('en-US', { weekday: 'long' });

    const todayTasks = schedule.filter(b => b.day === today);

    let nextTask = null;
    let minTimeDiff = Infinity;

    todayTasks.forEach(block => {
        const taskStart = timeToMinutes(block.start);
        const timeDiff = taskStart - currentMinutes;
        if (timeDiff > 1 && timeDiff < minTimeDiff) {
            minTimeDiff = timeDiff;
            nextTask = block;
        }
    });

    if (!nextTask) return;

    // Milliseconds from now until 1 minute before the task starts
    const nowMs = currentMinutes * 60_000 + now.getSeconds() * 1000 + now.getMilliseconds();
    const targetMs = (timeToMinutes(nextTask.start) - 1) * 60_000;
    let delay = targetMs - nowMs;
    if (delay < 0) delay += 24 * 60 * 60_000;

    notificationTimeout = setTimeout(() => {
        showNotification(nextTask);
        scheduleNextNotification(schedule, notificationsEnabled);
    }, delay);
}

function showNotification(task) {
    if (Notification.permission === 'granted') {
        new Notification('Upcoming Task', {
            body: `"${task.projectName || task.taskName || 'Task'}" starts in 1 minute.`
        });
    }
}

export async function requestNotificationPermission() {
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
}
