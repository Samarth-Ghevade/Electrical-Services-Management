// ===========================================
// Shree Electrical Service
// mongo-client.js
// Talks to the Node + MongoDB server (server/server.js).
// Exposes Firestore-style and Auth-style functions so the
// rest of the project works unchanged.
// ===========================================

// ---------- API address ----------
// Same server serves site + API (http://localhost:3000).
// If you open the site from another port (e.g. Live Server),
// requests go to http://localhost:3000. Override with
// window.API_BASE = "https://your-server.com" before loading scripts.
const API_BASE =
    window.API_BASE !== undefined
        ? window.API_BASE
        : (location.hostname === "localhost" || location.hostname === "127.0.0.1") &&
          location.port !== "3000"
            ? "http://localhost:3000"
            : "";

const TOKEN_KEY = "shree_token";
const POLL_MS = 4000;

// ===========================================
// Timestamp (like Firestore Timestamp)
// ===========================================
export class Timestamp {
    constructor(date) {
        this._d = date instanceof Date ? date : new Date(date);
        this.seconds = Math.floor(this._d.getTime() / 1000);
        this.nanoseconds = (this._d.getTime() % 1000) * 1e6;
    }
    toDate() { return this._d; }
    toMillis() { return this._d.getTime(); }
    toJSON() { return { __ts: this._d.toISOString() }; }
    static now() { return new Timestamp(new Date()); }
    static fromDate(d) { return new Timestamp(d); }
}

export const serverTimestamp = () => ({ __serverTimestamp: true });

function revive(v) {
    if (Array.isArray(v)) return v.map(revive);
    if (v && typeof v === "object") {
        if (typeof v.__ts === "string") return new Timestamp(v.__ts);
        const o = {};
        for (const k of Object.keys(v)) o[k] = revive(v[k]);
        return o;
    }
    return v;
}

// ===========================================
// HTTP helper
// ===========================================
function getToken() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

async function api(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    const t = getToken();
    if (t) headers.Authorization = "Bearer " + t;

    let res;
    try {
        res = await fetch(API_BASE + path, {
            method,
            headers,
            body: body === undefined ? undefined : JSON.stringify(body)
        });
    } catch (e) {
        const err = new Error("Network error");
        err.code = "auth/network-request-failed";
        throw err;
    }

    let json = {};
    try { json = await res.json(); } catch { /* empty */ }

    if (!res.ok) {
        const err = new Error(json.message || json.code || "Request failed");
        err.code = json.code || "server-error";
        err.status = res.status;
        throw err;
    }
    return json;
}

// ===========================================
// "db" + Firestore-style functions
// ===========================================
export const db = { type: "mongodb" };

export const collection = (_db, name) => ({ type: "collection", name, constraints: [] });
export const doc = (_db, col, id) => ({ type: "doc", col, id });
export const where = (field, op, value) => ({ field, op, value });
export const query = (ref, ...constraints) => ({ ...ref, constraints });

function makeDocSnap(id, data, exists = true) {
    return {
        id,
        exists: () => exists,
        data: () => (exists ? revive(data) : undefined)
    };
}

function makeSnapshot(docs) {
    const snaps = docs.map((d) => makeDocSnap(d.id, d.data));
    return {
        docs: snaps,
        size: snaps.length,
        empty: snaps.length === 0,
        forEach: (fn) => snaps.forEach(fn)
    };
}

export async function getDocs(ref) {
    const r = await api("POST", `/api/${ref.name}/query`, {
        where: (ref.constraints || []).map((c) => [c.field, c.op, c.value])
    });
    return makeSnapshot(r.docs);
}

export async function getDoc(ref) {
    const r = await api("GET", `/api/${ref.col}/${encodeURIComponent(ref.id)}`);
    return r.exists ? makeDocSnap(r.doc.id, r.doc.data) : makeDocSnap(ref.id, null, false);
}

export async function addDoc(ref, data) {
    const r = await api("POST", `/api/${ref.name}`, { data });
    return { id: r.id };
}

export async function setDoc(ref, data, options = {}) {
    await api("PUT", `/api/${ref.col}/${encodeURIComponent(ref.id)}`, {
        data,
        merge: !!options.merge
    });
}

export async function updateDoc(ref, data) {
    await api("PATCH", `/api/${ref.col}/${encodeURIComponent(ref.id)}`, { data });
}

export async function deleteDoc(ref) {
    await api("DELETE", `/api/${ref.col}/${encodeURIComponent(ref.id)}`);
}

// Real-time listener -> simple polling (fires only when data changes)
export function onSnapshot(ref, onNext, onError) {
    let stopped = false;
    let last = null;
    let timer = null;

    async function tick() {
        if (stopped) return;
        try {
            const r = await api("POST", `/api/${ref.name}/query`, {
                where: (ref.constraints || []).map((c) => [c.field, c.op, c.value])
            });
            const sig = JSON.stringify(r.docs);
            if (sig !== last) {
                last = sig;
                onNext(makeSnapshot(r.docs));
            }
        } catch (e) {
            if (onError) onError(e);
        }
        if (!stopped) timer = setTimeout(tick, POLL_MS);
    }

    tick();
    return () => { stopped = true; clearTimeout(timer); };
}

// ===========================================
// Auth (email + password, JWT stored in localStorage)
// ===========================================
const listeners = new Set();

export const auth = { currentUser: null, ready: false };

function setUser(user, token) {
    auth.currentUser = user;
    auth.ready = true;
    try {
        if (token) localStorage.setItem(TOKEN_KEY, token);
        if (!user) localStorage.removeItem(TOKEN_KEY);
    } catch { /* ignore */ }
    listeners.forEach((cb) => { try { cb(user); } catch (e) { console.error(e); } });
}

let initPromise = null;
function initAuth() {
    if (!initPromise) {
        initPromise = (async () => {
            if (!getToken()) { auth.ready = true; return null; }
            try {
                const r = await api("GET", "/api/auth/me");
                auth.currentUser = r.user;
            } catch (e) {
                // Server down: keep token, treat as signed out for now
                if (e.status === 401) {
                    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
                }
                auth.currentUser = null;
            }
            auth.ready = true;
            return auth.currentUser;
        })();
    }
    return initPromise;
}

export function onAuthStateChanged(_auth, callback) {
    listeners.add(callback);
    initAuth().then((u) => { if (listeners.has(callback)) callback(u); });
    return () => listeners.delete(callback);
}

export async function signInWithEmailAndPassword(_auth, email, password) {
    const r = await api("POST", "/api/auth/login", { email, password });
    setUser(r.user, r.token);
    return { user: r.user };
}

export async function createUserWithEmailAndPassword(_auth, email, password) {
    const r = await api("POST", "/api/auth/register", { email, password });
    setUser(r.user, r.token);
    return { user: r.user };
}

export async function updateProfile(user, { displayName }) {
    await api("PATCH", "/api/auth/profile", { displayName });
    if (auth.currentUser) auth.currentUser.displayName = displayName;
    if (user) user.displayName = displayName;
}

export async function signOut(_auth) {
    setUser(null);
}
