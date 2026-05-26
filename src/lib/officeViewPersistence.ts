const OFFICE_OPEN_JOB_ID = 'office-open-job-id';
const OFFICE_OPEN_JOB_TAB = 'office-open-job-tab';
const DEBUG_RING_KEY = 'office-debug-ring-ca9250';
const DEBUG_INGEST = 'http://127.0.0.1:7264/ingest/38c719fd-41f2-436e-b178-2936be94ecc3';

function jobStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    try {
      return sessionStorage;
    } catch {
      return null;
    }
  }
}

export function readPersistedOpenJobId(): string | null {
  const store = jobStorage();
  if (!store) return null;
  try {
    const id = store.getItem(OFFICE_OPEN_JOB_ID);
    return id?.trim() || null;
  } catch {
    return null;
  }
}

export function readPersistedOpenJobTab(): string | null {
  const store = jobStorage();
  if (!store) return null;
  try {
    const tab = store.getItem(OFFICE_OPEN_JOB_TAB);
    return tab?.trim() || null;
  } catch {
    return null;
  }
}

export function persistOpenJob(jobId: string | null, tab?: string | null): void {
  const store = jobStorage();
  if (!store) return;
  try {
    if (jobId) {
      store.setItem(OFFICE_OPEN_JOB_ID, jobId);
      if (tab) store.setItem(OFFICE_OPEN_JOB_TAB, tab);
    } else {
      store.removeItem(OFFICE_OPEN_JOB_ID);
      store.removeItem(OFFICE_OPEN_JOB_TAB);
    }
  } catch {
    /* ignore */
  }
}

export function persistOpenJobTab(tab: string): void {
  const store = jobStorage();
  if (!store) return;
  try {
    if (readPersistedOpenJobId()) {
      store.setItem(OFFICE_OPEN_JOB_TAB, tab);
    }
  } catch {
    /* ignore */
  }
}

export function agentLog(payload: Record<string, unknown>): void {
  const entry = { sessionId: 'ca9250', ...payload, timestamp: Date.now() };
  try {
    const raw = localStorage.getItem(DEBUG_RING_KEY);
    const arr: Record<string, unknown>[] = raw ? JSON.parse(raw) : [];
    arr.push(entry);
    while (arr.length > 40) arr.shift();
    localStorage.setItem(DEBUG_RING_KEY, JSON.stringify(arr));
  } catch {
    /* ignore */
  }
  fetch(DEBUG_INGEST, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ca9250' },
    body: JSON.stringify(entry),
  }).catch(() => {});
  if (import.meta.env.DEV) {
    fetch('/__debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => {});
    console.info('[office-view]', entry.message, entry.data);
  }
}

export function flushAgentDebugLogs(): void {
  try {
    const raw = localStorage.getItem(DEBUG_RING_KEY);
    if (!raw) return;
    const arr: Record<string, unknown>[] = JSON.parse(raw);
    for (const entry of arr) {
      fetch(DEBUG_INGEST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'ca9250' },
        body: JSON.stringify(entry),
      }).catch(() => {});
      if (import.meta.env.DEV) {
        fetch('/__debug/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(entry),
        }).catch(() => {});
      }
    }
    localStorage.removeItem(DEBUG_RING_KEY);
  } catch {
    /* ignore */
  }
}
