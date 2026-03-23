// ============================================================
// heartbeat.js — single-instance enforcement via localStorage
// ============================================================

import { HEARTBEAT_KEY, HEARTBEAT_INTERVAL, HEARTBEAT_EXPIRATION } from './config.js';

const instanceId = `${Date.now()}-${Math.random()}`;
let heartbeatTimer = null;

function setHeartbeat() {
    localStorage.setItem(HEARTBEAT_KEY, JSON.stringify({ id: instanceId, timestamp: Date.now() }));
}

function isAnotherInstanceRunning() {
    const raw = localStorage.getItem(HEARTBEAT_KEY);
    if (!raw) return false;
    try {
        const hb = JSON.parse(raw);
        return hb.id !== instanceId && (Date.now() - hb.timestamp) < HEARTBEAT_EXPIRATION;
    } catch {
        return false;
    }
}

function showDuplicateMessage() {
    const el = document.getElementById('duplicate-instance-message');
    if (el) el.classList.add('visible');
}

/**
 * Call once at startup.
 * Returns true if this is the primary instance (app should run),
 * false if a duplicate was detected (app should stop).
 */
export function initHeartbeat() {
    if (isAnotherInstanceRunning()) {
        showDuplicateMessage();
        return false;
    }

    setHeartbeat();
    heartbeatTimer = setInterval(setHeartbeat, HEARTBEAT_INTERVAL);

    window.addEventListener('storage', (e) => {
        if (e.key !== HEARTBEAT_KEY || !e.newValue) return;
        try {
            const hb = JSON.parse(e.newValue);
            if (hb.id !== instanceId && (Date.now() - hb.timestamp) < HEARTBEAT_EXPIRATION) {
                showDuplicateMessage();
                clearInterval(heartbeatTimer);
            }
        } catch { /* ignore */ }
    });

    window.addEventListener('beforeunload', () => {
        const raw = localStorage.getItem(HEARTBEAT_KEY);
        try {
            const hb = JSON.parse(raw);
            if (hb.id === instanceId) localStorage.removeItem(HEARTBEAT_KEY);
        } catch { /* ignore */ }
        clearInterval(heartbeatTimer);
    });

    return true;
}
