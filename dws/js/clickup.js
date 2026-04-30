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
    const isActive = t => t.status?.type !== 'closed' && t.status?.type !== 'done';
    const parentTasks = (data.tasks || []).filter(isActive);

    // 2. Fetch subtasks for all parent tasks in parallel
    //    (subtask_count is unreliable in the list response, so we check all)
    const subtaskArrays = await Promise.all(
        parentTasks
            .map(task =>
                apiGet(`/team/${teamId}/task?parent=${task.id}&include_closed=false`, token)
                    .then(d => (d.tasks || [])
                        .filter(isActive)
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

export async function registerTime(token, taskId, teamId, startTimestamp, durationMs, description, userId) {
    const body = { tid: taskId, start: startTimestamp, stop: startTimestamp + durationMs, duration: durationMs, description: description || '' };
    if (userId) body.assignee = userId;
    return apiPost(`/team/${encodeURIComponent(teamId)}/time_entries`, body, token);
}

async function apiDelete(path, token) {
    const resp = await fetch(`https://api.clickup.com/api/v2${path}`, {
        method: 'DELETE',
        headers: { 'Authorization': token }
    });
    if (resp.status === 401) throw new Error('Invalid API token.');
    if (!resp.ok) throw new Error(`ClickUp API error (${resp.status}).`);
    return resp.json();
}

export async function getTimeEntries(token, teamId, taskId, startMs, endMs, userId) {
    let path = `/team/${encodeURIComponent(teamId)}/time_entries?start_date=${startMs}&end_date=${endMs}&task_id=${encodeURIComponent(taskId)}`;
    if (userId) path += `&assignee=${userId}`;
    const data = await apiGet(path, token);
    return data.data || [];
}

export async function deleteTimeEntry(token, teamId, entryId) {
    return apiDelete(`/team/${encodeURIComponent(teamId)}/time_entries/${encodeURIComponent(entryId)}`, token);
}
