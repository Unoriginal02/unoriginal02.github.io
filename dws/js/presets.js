// ============================================================
// presets.js — project/task preset management
// ============================================================

import { alphaCompare } from './utils.js';

// Shared mutable array — mutated in place so all importers see updates
export const projectTaskPresets = [];

export function setPresets(arr) {
    projectTaskPresets.length = 0;
    arr.forEach(p => projectTaskPresets.push(p));
}

export function normalizePreset(preset) {
    return {
        projectName: (preset.projectName || '').trim(),
        taskName: (preset.taskName || '').trim(),
        taskId: (preset.taskId || '').trim()
    };
}

function presetEquals(a, b) {
    return a.projectName === b.projectName &&
        a.taskName === b.taskName &&
        a.taskId === b.taskId;
}

export function saveProjectTaskPreset(preset, onSave) {
    const normalized = normalizePreset(preset);
    const isEmpty = !normalized.projectName && !normalized.taskName && !normalized.taskId;
    if (isEmpty) return;

    const alreadyExists = projectTaskPresets.some(p => presetEquals(normalizePreset(p), normalized));
    if (!alreadyExists) {
        projectTaskPresets.push(normalized);
        if (onSave) onSave();
    }
}

export function deleteProjectTaskPreset(index, onDelete) {
    projectTaskPresets.splice(index, 1);
    if (onDelete) onDelete();
}

export function getGroupedSortedPresets() {
    // Preserve insertion order — no alphabetical sort, so drag reordering is respected
    const normalized = projectTaskPresets.map((preset, index) => ({
        ...normalizePreset(preset),
        originalIndex: index
    }));

    const groups = [];
    const groupMap = new Map();

    normalized.forEach(preset => {
        const key = preset.projectName;
        if (!groupMap.has(key)) {
            const group = { projectName: preset.projectName, tasks: [] };
            groupMap.set(key, group);
            groups.push(group);
        }
        groupMap.get(key).tasks.push(preset);
    });

    return groups;
}

/**
 * Move the preset at `fromIndex` to `toIndex` in the flat array.
 */
export function movePreset(fromIndex, toIndex) {
    if (fromIndex === toIndex) return;
    const [item] = projectTaskPresets.splice(fromIndex, 1);
    projectTaskPresets.splice(toIndex, 0, item);
}
