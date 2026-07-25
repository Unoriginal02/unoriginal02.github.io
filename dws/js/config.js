// ============================================================
// config.js — constants and color theme definitions
// ============================================================

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
export const TIME_SLOT_INTERVAL = 15; // minutes

// Block colours are drawn from the same 16-colour ANSI scheme as the UI
// (Tokyo Night) so a card never emits a hue a terminal could not print. Keys
// are unchanged — stored schedules keep resolving.
export const COLOR_THEMES = {
    dark: {
        red: '#F7768E',
        orange: '#FF9E64',
        yellow: '#E0AF68',
        lime: '#CFE86B',
        green: '#9ECE6A',
        teal: '#73DACA',
        cyan: '#7DCFFF',
        blue: '#7AA2F7',
        purple: '#9D7CD8',
        magenta: '#BB9AF7',
        pink: '#FF9EC3',
        gray: '#565F89'
    }
};

export const COLOR_DISPLAY_NAMES = {
    red: 'Red',
    orange: 'Orange',
    yellow: 'Yellow',
    lime: 'Lime',
    green: 'Green',
    teal: 'Teal',
    cyan: 'Cyan',
    blue: 'Blue',
    purple: 'Purple',
    magenta: 'Magenta',
    pink: 'Pink',
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
