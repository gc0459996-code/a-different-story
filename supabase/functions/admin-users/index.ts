// Lets staff with the "accounts" permission add accounts and change a person's
// name, phone, login email, password, role and permissions.
// Runs on Supabase's servers, so the service role key never reaches the browser.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ROLES = ["student", "instructor", "staff", "admin"];
const PERMS = ["classes", "students", "payments", "accounts", "messages"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Students have no permissions and admins have all of them.
function cleanAccess(role: string, perms: unknown): string[] {
  if (role === "admin") return [...PERMS];
  if (role === "student") return [];
  return Array.isArray(perms) ? PERMS.filter((p) => perms.includes(p)) : [];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Who is calling, and may they manage accounts?
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: me } = await admin.from("profiles").select("*").eq("id", user.id).single();
    const myRole = me?.role ?? (me?.is_admin ? "admin" : "student");
    const myPerms: string[] = myRole === "admin" ? PERMS : (me?.permissions ?? []);
    if (myRole === "student" || !myPerms.includes("accounts")) return json({ error: "You don't have permission to manage accounts." }, 403);
    const isAdmin = myRole === "admin";

    const body = await req.json();

    // Add a new account
    if (body.action === "create") {
      const email = String(body.email ?? "").trim().toLowerCase();
      if (!EMAIL.test(email)) return json({ error: "That email doesn't look right." }, 400);
      const role = ROLES.includes(body.role) ? body.role : "student";
      if (role === "admin" && !isAdmin) return json({ error: "Only an admin can add another admin." }, 403);
      const password = body.password ? String(body.password) : "";
      if (password && password.length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
      if (body.class_id && !myPerms.includes("students")) return json({ error: "You don't have permission to enroll students." }, 403);

      const { data: made, error } = await admin.auth.admin.createUser({
        email,
        password: password || crypto.randomUUID() + "Aa1!",
        email_confirm: true,
        user_metadata: { full_name: String(body.full_name ?? "").trim() },
      });
      if (error) return json({ error: /already/i.test(error.message) ? "An account with that email already exists." : error.message }, 400);
      const id = made.user.id;

      const { error: pe } = await admin.from("profiles").upsert({
        id, email,
        full_name: String(body.full_name ?? "").trim(),
        phone: String(body.phone ?? "").trim(),
        role, permissions: cleanAccess(role, body.permissions), is_admin: role === "admin",
      });
      if (pe) return json({ error: pe.message }, 400);

      if (body.class_id) {
        const { error: ee } = await admin.from("enrollments").insert({ student_id: id, class_id: Number(body.class_id) });
        if (ee) return json({ error: "Account created, but enrolling in the class failed: " + ee.message }, 400);
      }

      // No password given: email them a link to choose their own.
      let emailed = false;
      if (!password) {
        const redirectTo = typeof body.site_url === "string" && /^https?:\/\//.test(body.site_url) ? body.site_url : undefined;
        const { error: re } = await admin.auth.resetPasswordForEmail(email, { redirectTo });
        emailed = !re;
      }
      return json({ ok: true, id, emailed });
    }

    // Change an existing account
    if (body.action === "update" && typeof body.user_id === "string") {
      const { data: target } = await admin.from("profiles").select("*").eq("id", body.user_id).single();
      if (!target) return json({ error: "Account not found." }, 404);
      const targetRole = target.role ?? (target.is_admin ? "admin" : "student");
      if (targetRole === "admin" && !isAdmin) return json({ error: "Only an admin can change an admin's account." }, 403);

      const profile: Record<string, unknown> = {};
      if (body.role !== undefined || body.permissions !== undefined) {
        const role = ROLES.includes(body.role) ? body.role : targetRole;
        if (body.user_id === user.id && (role !== targetRole || (role !== "admin" && JSON.stringify(cleanAccess(role, body.permissions)) !== JSON.stringify(cleanAccess(role, target.permissions))))) {
          return json({ error: "You can't change your own role or permissions. Ask another admin." }, 403);
        }
        if (role === "admin" && !isAdmin) return json({ error: "Only an admin can make someone an admin." }, 403);
        profile.role = role;
        profile.permissions = cleanAccess(role, body.permissions);
        profile.is_admin = role === "admin";
      }

      const login: Record<string, unknown> = {};
      if (body.email) {
        const email = String(body.email).trim().toLowerCase();
        if (!EMAIL.test(email)) return json({ error: "That email doesn't look right." }, 400);
        login.email = email;
        login.email_confirm = true;
      }
      if (body.password) {
        if (String(body.password).length < 8) return json({ error: "Password must be at least 8 characters." }, 400);
        login.password = String(body.password);
      }
      if (Object.keys(login).length) {
        const { error } = await admin.auth.admin.updateUserById(body.user_id, login);
        if (error) return json({ error: error.message }, 400);
      }

      if (typeof body.full_name === "string") profile.full_name = body.full_name.trim();
      if (typeof body.phone === "string") profile.phone = body.phone.trim();
      if (login.email) profile.email = login.email;
      if (Object.keys(profile).length) {
        const { error } = await admin.from("profiles").update(profile).eq("id", body.user_id);
        if (error) return json({ error: error.message }, 400);
      }
      return json({ ok: true });
    }

    return json({ error: "Bad request." }, 400);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
