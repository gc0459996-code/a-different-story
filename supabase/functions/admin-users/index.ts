// Lets an admin change a student's name, phone, login email or password.
// Runs on Supabase's servers, so the service role key never reaches the browser.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Who is calling, and are they an admin?
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await admin.auth.getUser(token);
    if (!user) return json({ error: "Please log in again." }, 401);
    const { data: me } = await admin.from("profiles").select("is_admin").eq("id", user.id).single();
    if (!me?.is_admin) return json({ error: "Only admins can do this." }, 403);

    const body = await req.json();
    if (body.action !== "update" || typeof body.user_id !== "string") return json({ error: "Bad request." }, 400);

    // Login details (email, password)
    const login: Record<string, unknown> = {};
    if (body.email) {
      const email = String(body.email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "That email doesn't look right." }, 400);
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

    // Profile details
    const profile: Record<string, unknown> = {};
    if (typeof body.full_name === "string") profile.full_name = body.full_name.trim();
    if (typeof body.phone === "string") profile.phone = body.phone.trim();
    if (login.email) profile.email = login.email;
    if (Object.keys(profile).length) {
      const { error } = await admin.from("profiles").update(profile).eq("id", body.user_id);
      if (error) return json({ error: error.message }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
