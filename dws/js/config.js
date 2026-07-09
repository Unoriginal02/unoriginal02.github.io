// ============================================================
// config.js — constants and color theme definitions
// ============================================================

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const TIME_SLOT_INTERVAL = 15; // minutes

export const COLOR_THEMES = {
    dark: {
        red: '#FF4D4D',
        orange: '#FF8A3D',
        yellow: '#FFD400',
        green: '#3DFF7A',
        blue: '#3D8BFF',
        purple: '#B44DFF',
        pink: '#FF4DB8',
        cyan: '#00D5FF',
        teal: '#00C2A8',
        lime: '#B6FF00',
        magenta: '#D500FF',
        gray: '#3B3B3C'
    }
};

export const COLOR_DISPLAY_NAMES = {
    red: 'Red',
    orange: 'Orange',
    yellow: 'Yellow',
    green: 'Green',
    blue: 'Blue',
    purple: 'Purple',
    pink: 'Pink',
    cyan: 'Cyan',
    teal: 'Teal',
    lime: 'Lime',
    magenta: 'Magenta',
    gray: 'Gray'
};

export const AVAILABLE_COLORS = Object.keys(COLOR_THEMES.dark);

// IndexedDB
export const DB_NAME = 'deepWorkScheduleDB';
export const DB_VERSION = 1;
export const STORE_NAME = 'appState';

// Heartbeat
export const HEARTBEAT_KEY = 'app-heartbeat';
export const HEARTBEAT_INTERVAL = 1000;   // ms
export const HEARTBEAT_EXPIRATION = 5000; // ms
