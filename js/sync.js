/**
 * Shared-budget sync over Supabase.
 *
 * Flow:
 *   local edit  -> debounce -> read server copy -> merge -> save if version unchanged
 *   server edit -> realtime event -> merge into this phone
 * Conflicts are resolved record-by-record (see merge.js), so two people logging
 * at the same moment never lose each other's entries. Offline edits stay on the
 * phone and sync on reconnect.
 *
 * The Supabase client (js/vendor/supabase.js, v2.119.0) is loaded lazily so the
 * app opens instantly and works fully offline without it.
 */
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";
import { mergeStates, sameData } from "./merge.js";
import { normalize } from "./store.js";

const META_KEY = "pocket:sync";
const PUSH_DELAY = 700;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load sync library"));
    document.head.append(s);
  });
}

/** Turn Supabase/network errors into something a person can act on. */
export function friendlyError(err) {
  const msg = String(err?.message ?? err ?? "");
  if (/invalid login credentials/i.test(msg)) return "Email or password is incorrect.";
  if (/already registered|already exists/i.test(msg)) return "That email already has an account. Try signing in.";
  if (/password.*(at least|short|weak)/i.test(msg)) return "Password needs at least 8 characters.";
  if (/invalid invite code/i.test(msg)) return "That invite code didn't match. Check it and try again.";
  if (/email.*invalid|invalid.*email/i.test(msg)) return "That email address doesn't look right.";
  if (/fetch|network|load sync/i.test(msg)) return "You're offline. Try again when you have a connection.";
  return msg || "Something went wrong. Please try again.";
}

export function createSync(store, { onChange = () => {}, onRemoteEdit = () => {} } = {}) {
  const enabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
  let client = null;
  let channel = null;
  let meta = readMeta(); // { householdId, version }
  let pushTimer = null;
  let pushing = false;
  let again = false;

  const info = {
    enabled,
    ready: false,
    user: null, // { id, email, name }
    household: null, // { id, name, invite_code }
    members: [],
    status: enabled ? "starting" : "off", // off | starting | signed-out | no-household | syncing | synced | offline | error
    lastSynced: 0,
    error: "",
  };

  function readMeta() {
    try { return JSON.parse(localStorage.getItem(META_KEY)) ?? {}; } catch { return {}; }
  }
  function writeMeta(next) {
    meta = next;
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }
  function set(patch) {
    Object.assign(info, patch);
    onChange(info);
  }

  async function lib() {
    if (client) return client;
    if (!window.supabase) await loadScript("./js/vendor/supabase.js");
    client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "pocket:auth", detectSessionInUrl: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
    client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") stop("signed-out");
      if (session) client.realtime.setAuth(session.access_token);
    });
    return client;
  }

  const check = ({ data, error }) => {
    if (error) throw error;
    return data;
  };

  // ---------------------------------------------------------------- lifecycle
  async function start() {
    if (!enabled) return;
    try {
      const sb = await lib();
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return set({ ready: true, status: "signed-out", user: null });
      set({ user: { id: user.id, email: user.email, name: user.user_metadata?.name ?? "" } });
      await connect();
    } catch (err) {
      set({ ready: true, status: navigator.onLine ? "error" : "offline", error: friendlyError(err) });
    }
  }

  async function connect() {
    const sb = await lib();
    if (!meta.householdId) {
      // Signed in on a new phone: find the household this account belongs to.
      const rows = check(await sb.from("household_members").select("household_id").eq("user_id", info.user.id).limit(1));
      if (!rows.length) return set({ ready: true, status: "no-household", household: null, members: [] });
      writeMeta({ householdId: rows[0].household_id, version: 0 });
    }
    await pull({ preferRemoteSettings: !store.state.onboarded });
    subscribe();
    loadMembers();
  }

  function stop(status) {
    channel?.unsubscribe();
    channel = null;
    clearTimeout(pushTimer);
    writeMeta({});
    set({ ready: true, status, household: null, members: [], ...(status === "signed-out" ? { user: null } : {}) });
  }

  // ---------------------------------------------------------------- data flow
  async function fetchRemote() {
    const sb = await lib();
    const row = check(await sb.from("households")
      .select("id, name, invite_code, state, version, updated_by")
      .eq("id", meta.householdId).maybeSingle());
    if (!row) throw Object.assign(new Error("Shared budget no longer exists"), { gone: true });
    return row;
  }

  function applyMerged(merged) {
    if (!sameData(merged, store.state)) store.replace(merged, { stamp: false, source: "remote" });
  }

  async function pull({ preferRemoteSettings = false, notify = false } = {}) {
    set({ status: "syncing" });
    try {
      const row = await fetchRemote();
      const remote = normalize(row.state);
      const before = store.state;
      const local = preferRemoteSettings ? { ...before, settingsAt: 0 } : before;
      const merged = mergeStates(local, remote);
      writeMeta({ ...meta, version: row.version });
      set({ household: { id: row.id, name: row.name, invite_code: row.invite_code } });
      applyMerged(merged);
      if (notify && row.updated_by && row.updated_by !== info.user?.id && !sameData(before, merged)) {
        const who = info.members.find((m) => m.user_id === row.updated_by)?.display_name;
        onRemoteEdit(who || "Someone");
      }
      if (!sameData(merged, remote)) schedulePush(0);
      else set({ ready: true, status: "synced", lastSynced: Date.now(), error: "" });
    } catch (err) {
      if (err.gone) return stop("no-household");
      set({ ready: true, status: navigator.onLine ? "error" : "offline", error: friendlyError(err) });
    }
  }

  function schedulePush(delay = PUSH_DELAY) {
    if (!meta.householdId) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, delay);
  }

  async function push() {
    if (!meta.householdId) return;
    if (pushing) { again = true; return; }
    pushing = true;
    set({ status: "syncing" });
    try {
      const sb = await lib();
      for (let attempt = 0; attempt < 5; attempt++) {
        const row = await fetchRemote();
        const merged = mergeStates(store.state, normalize(row.state));
        if (sameData(merged, normalize(row.state))) {
          writeMeta({ ...meta, version: row.version });
          applyMerged(merged);
          break;
        }
        const version = check(await sb.rpc("save_state", {
          p_household: meta.householdId, p_state: merged, p_expected: row.version,
        }));
        if (version != null) {
          writeMeta({ ...meta, version });
          applyMerged(merged);
          break;
        }
        // Someone else saved first: loop re-reads and merges their changes.
      }
      set({ ready: true, status: "synced", lastSynced: Date.now(), error: "" });
    } catch (err) {
      if (err.gone) return stop("no-household");
      set({ ready: true, status: navigator.onLine ? "error" : "offline", error: friendlyError(err) });
    } finally {
      pushing = false;
      if (again) { again = false; schedulePush(0); }
    }
  }

  function subscribe() {
    channel?.unsubscribe();
    channel = client.channel(`household-${meta.householdId}`)
      .on("postgres_changes", {
        event: "*", schema: "public", table: "households", filter: `id=eq.${meta.householdId}`,
      }, (payload) => {
        if (payload.eventType === "DELETE") return stop("no-household");
        // Treat the event as a signal and fetch the full row: large payloads
        // can be truncated by realtime, and this also merges correctly.
        const version = payload.new?.version;
        if (version && version <= (meta.version ?? 0)) return; // our own save echoing back
        if (!pushing) pull({ notify: true });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "household_members" }, () => loadMembers())
      .subscribe((status) => {
        if (status === "SUBSCRIBED") pull(); // catch anything missed while disconnected
      });
  }

  async function loadMembers() {
    if (!meta.householdId) return;
    try {
      const sb = await lib();
      const members = check(await sb.from("household_members")
        .select("user_id, display_name, joined_at").eq("household_id", meta.householdId).order("joined_at"));
      set({ members });
    } catch { /* non-critical */ }
  }

  // Local edits flow to the server; a local reset disconnects instead of syncing a wipe.
  store.subscribe((_state, { source }) => {
    if (source === "local") schedulePush();
    if (source === "reset" && meta.householdId) stop(info.user ? "no-household" : "signed-out");
  });
  window.addEventListener("online", () => { if (meta.householdId) pull(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && meta.householdId && Date.now() - info.lastSynced > 30000) pull();
  });

  // ---------------------------------------------------------------- account actions
  async function signUp({ name, email, password }) {
    const sb = await lib();
    const data = check(await sb.auth.signUp({ email, password, options: { data: { name } } }));
    if (!data.session) throw new Error("Check your email to confirm your account, then sign in.");
    set({ user: { id: data.user.id, email: data.user.email, name } });
    await connect();
  }

  async function signIn({ email, password }) {
    const sb = await lib();
    const data = check(await sb.auth.signInWithPassword({ email, password }));
    set({ user: { id: data.user.id, email: data.user.email, name: data.user.user_metadata?.name ?? "" } });
    await connect();
  }

  async function signOut() {
    const sb = await lib();
    channel?.unsubscribe();
    await sb.auth.signOut();
    stop("signed-out"); // keeps this phone's copy; just stops syncing
  }

  async function createHousehold(name) {
    const sb = await lib();
    const [row] = check(await sb.rpc("create_household", {
      p_name: name, p_display_name: info.user?.name ?? "", p_state: store.state,
    }));
    writeMeta({ householdId: row.id, version: row.version });
    set({ household: { id: row.id, name, invite_code: row.invite_code }, status: "synced", lastSynced: Date.now() });
    subscribe();
    loadMembers();
  }

  async function joinHousehold(code) {
    const sb = await lib();
    const id = check(await sb.rpc("join_household", { p_code: code, p_display_name: info.user?.name ?? "" }));
    writeMeta({ householdId: id, version: 0 });
    await pull({ preferRemoteSettings: true }); // the shared plan wins over this phone's setup
    subscribe();
    loadMembers();
  }

  async function leaveHousehold() {
    const sb = await lib();
    check(await sb.rpc("leave_household", { p_household: meta.householdId }));
    stop("no-household");
  }

  return {
    info,
    start,
    signUp,
    signIn,
    signOut,
    createHousehold,
    joinHousehold,
    leaveHousehold,
    syncNow: () => (meta.householdId ? pull() : Promise.resolve()),
  };
}
