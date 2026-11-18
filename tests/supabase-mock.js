// A tiny stand-in for the Supabase library, used only by tests/e2e.cjs.
// It keeps tables in memory (window.__mockDb) so the tests can log in and use the admin pages
// without a real Supabase project. It is never loaded by the live site.
(function () {
  const db = window.__mockDb || (window.__mockDb = {});
  db.__id = db.__id || 1000;
  db.__uploads = db.__uploads || [];
  function query(table) {
    const rows = () => db[table] || (db[table] = []);
    let op = "select", payload = null, single = false, head = false, orderBy = null;
    const filters = [];
    const b = {
      select(_cols, o) { if (o && o.head) head = true; return b; },
      insert(p) { op = "insert"; payload = p; return b; },
      update(p) { op = "update"; payload = p; return b; },
      upsert(p) { op = "upsert"; payload = p; return b; },
      delete() { op = "delete"; return b; },
      eq(c, v) { filters.push((r) => r[c] == v); return b; },
      in(c, vs) { filters.push((r) => vs.includes(r[c])); return b; },
      order(c, o) { orderBy = [c, !o || o.ascending !== false]; return b; },
      limit() { return b; },
      maybeSingle() { single = true; return b; },
      single() { single = true; return b; },
      then(res, rej) { return Promise.resolve().then(run).then(res, rej); }
    };
    function run() {
      const deny = (db.__deny || {})[table];
      if (deny && (op !== "select" || deny === "all")) return { data: null, error: { message: deny === "all" ? `relation "public.${table}" does not exist` : "new row violates row-level security policy" } };
      const all = rows(), match = all.filter((r) => filters.every((f) => f(r)));
      if (op === "insert") { const arr = [].concat(payload).map((p) => ({ id: ++db.__id, created_at: new Date().toISOString(), status: "open", location: "Live online (Zoom)", ...p })); all.push(...arr); return { data: arr, error: null }; }
      if (op === "upsert") { [].concat(payload).forEach((p) => { const i = all.findIndex((r) => r.key === p.key); if (i >= 0) all[i] = { ...all[i], ...p }; else all.push({ ...p }); }); return { data: null, error: null }; }
      if (op === "update") { match.forEach((r) => Object.assign(r, payload)); return { data: match, error: null }; }
      if (op === "delete") { db[table] = all.filter((r) => !match.includes(r)); return { data: null, error: null }; }
      let out = match.map((r) => ({ ...r }));
      if (table === "enrollments") out = out.map((r) => ({ ...r, classes: (db.classes || []).find((c) => c.id === r.class_id) || null, profiles: (db.profiles || []).find((p) => p.id === r.student_id) || null }));
      if (orderBy) { const [c, asc] = orderBy; out.sort((x, y) => (x[c] > y[c] ? 1 : x[c] < y[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (head) return { data: null, count: out.length, error: null };
      return { data: single ? out[0] || null : out, count: out.length, error: null };
    }
    return b;
  }
  window.supabase = {
    createClient() {
      let session = null;
      return {
        auth: {
          getSession: async () => ({ data: { session } }),
          signInWithPassword: async ({ email }) => {
            const p = (db.profiles || []).find((x) => x.email === email);
            if (!p) return { data: {}, error: { message: "Invalid login credentials" } };
            session = { user: { id: p.id, email, user_metadata: { full_name: p.full_name } } };
            return { data: { session }, error: null };
          },
          signOut: async () => { session = null; return {}; },
          signUp: async () => ({ data: {}, error: null }),
          updateUser: async () => ({ data: {}, error: null }),
          resetPasswordForEmail: async () => ({ data: {}, error: null }),
          onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
        },
        from: query,
        rpc: async () => ({ data: null, error: null }),
        functions: { invoke: async () => ({ data: {}, error: null }) },
        channel() { const c = { on() { return c; }, subscribe() { return c; } }; return c; },
        removeChannel() {},
        storage: {
          from(bucket) {
            return {
              upload: async (path, blob) => { db.__uploads.push({ path, size: blob.size, type: blob.type }); return { data: { path }, error: null }; },
              getPublicUrl: (path) => ({ data: { publicUrl: `https://mock-storage.test/${bucket}/${path}` } })
            };
          }
        }
      };
    }
  };
})();
