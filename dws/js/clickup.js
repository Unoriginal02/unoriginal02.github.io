// ============================================================
// clickup.js — ClickUp API integration
// ============================================================

const TOKEN_KEY = 'dws_clickup_token';
const USER_KEY  = 'dws_clickup_user';

export function getApiToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
export function setApiToken(token) { localStorage.setItem(TOKEN_KEY, token.trim()); }

export function getSavedUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)) || null; } catch { return null; }
}
function saveUser(user) { localStorage.setItem(USER_KEY, JSON.stringify(user)); }
export function clearUser() { localStorage.removeItem(USER_KEY); }

export function isConfigured() { return !!(getApiToken() && getSavedUser()); }

export function extractTaskId(input) {
    const trimmed = input.trim();
    const m = trimmed.match(/clickup\.com\/t\/([^/?#\s]+)/i);
    return m ? m[1] : trimmed;
}

async function apiGet(path, token) {
    const resp = await fetch(`https://api.clickup.com/api/v2${path}`, {
        headers: { 'Authorization': token }
    });
    if (resp.status === 401) throw new Error('Invalid API token.');
    if (!resp.ok) throw new Error(`ClickUp API error (${resp.status}).`);
    return resp.json();
}

async function apiPost(path, body, token) {
    const resp = await fetch(`https://api.clickup.com/api/v2${path}`, {
        method: 'POST',
        headers: { 'Authorization': token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (resp.status === 401) throw new Error('Invalid API token.');
    if (!resp.ok) throw new Error(`ClickUp API error (${resp.status}).`);
    return resp.json();
}

export async function initUserAndTeam(token) {
    const [userResp, teamsResp] = await Promise.all([
        apiGet('/user', token),
        apiGet('/team', token)
    ]);
    const user = {
        userId:   userResp.user.id,
        userName: userResp.user.username || userResp.user.email,
        teamId:   teamsResp.teams?.[0]?.id
    };
    saveUser(user);
    return user;
}

export async function fetchTask(input, token) {
    const id = extractTaskId(input);
    if (!id) throw new Error('No task ID provided.');
    return apiGet(`/task/${encodeURIComponent(id)}`, token);
}

export async function fetchAssignedTasks(token, teamId, userId) {
    // 1. Parent tasks directly assigned to user
    const params = `assignees[]=${userId}&include_closed=false&page=0`;
    const data = await apiGet(`/team/${teamId}/task?${params}`, token);
    const parentTasks = (data.tasks || []).filter(t => t.status?.type !== 'closed');

    // 2. Fetch subtasks for all parent tasks in parallel
    //    (subtask_count is unreliable in the list response, so we check all)
    const subtaskArrays = await Promise.all(
        parentTasks
            .map(task =>
                apiGet(`/team/${teamId}/task?parent=${task.id}&include_closed=false`, token)
                    .then(d => (d.tasks || [])
                        .filter(s => s.status?.type !== 'closed')
                        .map(s => ({ ...s, list: s.list || task.list }))
                    )
                    .catch(() => [])
            )
    );

    // 3. Merge and deduplicate
    const seen = new Set(parentTasks.map(t => t.id));
    const all = [...parentTasks];
    subtaskArrays.flat().forEach(sub => {
        if (!seen.has(sub.id)) { seen.add(sub.id); all.push(sub); }
    });

    return all;
}

export async function registerTime(token, taskId, startTimestamp, durationMs, description, userId) {
    const body = { start: startTimestamp, duration: durationMs, description: description || '' };
    if (userId) body.assignee = userId;
    return apiPost(`/task/${encodeURIComponent(taskId)}/time`, body, token);
}
