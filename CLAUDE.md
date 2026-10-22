# A Different Story — DWI school website

Website for **A Different Story**, a TDLR-licensed DWI school in Waco, Texas, owned by Glenn.
It offers two court-ordered courses: **DWI Education** (12 hours, first offense) and
**DWI Intervention** (32 hours, repeat offense). Students enroll, log in to see their
class/payment/certificate status, and message the school. Staff manage classes,
students, payments, accounts and messages from an admin dashboard.

Glenn is not a developer. He asks for changes in plain language (often by sending a
picture and naming a section) and checks the result on the live site.

## Stack and deployment

- **Static single page.** Everything (HTML, CSS, JS) is in `index.html`. No build step,
  no framework, no package.json, no tests.
- **Hosting: Netlify**, linked to this repo's `main` branch with no build command and no
  publish directory. **A push to `main` goes live in about a minute.** There is no
  staging site.
- **Backend: Supabase** project `prvvivttwebyolfinjjj`
  (`https://prvvivttwebyolfinjjj.supabase.co`). Auth, Postgres with row level security,
  Realtime (messages), and one Edge Function.
- Supabase JS is loaded from jsDelivr pinned at `@supabase/supabase-js@2.45.4`. Fonts are
  Poppins and Libre Baskerville from Google Fonts.

Because the repo root is published as-is, **every file in the repo is publicly
downloadable from the site.** Never commit secrets. The Supabase publishable key in
`CONFIG` is meant to be public; the service role key must never appear in this repo or
in the browser.

## Files

| Path | What it is |
|---|---|
| `index.html` | The whole site: styles in one `<style>` block, markup, then the script with `CONFIG` at the top. |
| `Media/` | Images used by the site (section backgrounds, logo, favicon). `Media/brand/logo-original.jpg` is the original logo upload. |
| `supabase-setup.sql` | First database setup: `profiles`, `classes`, `enrollments`, the new-user trigger, RLS, starter classes. |
| `roles-setup.sql` | Second script: roles and permissions, permission-aware RLS, enrollment update guard, `messages` table and Realtime. |
| `supabase/functions/admin-users/index.ts` | Edge Function for creating and editing accounts (needs the service role key, so it runs server-side). |

A mirror copy of these files lives in the project's shared folder at
`/mnt/project-files/website/` (plus an older Netlify drag-and-drop zip). The repo is the
source of truth; if you change a file here, update the mirror too so they stay identical.

## index.html layout

- **`CONFIG`** (top of the main `<script>`) holds the settings Glenn still has to fill
  in: `prices`, Stripe/Square `paymentLinks`, `formEndpoint`, `balanceLink`, `reviews`,
  `googleReviewLink`, `supabase` URL/key, and the fallback `sessions` list. Change
  settings here rather than hunting through markup.
- **Sections** in page order, by id: `home` (hero), `how`, `about`, `services`,
  `schedule`, `requirements` (What to Bring), `testimonials`, `verify` (3 Things to Check
  Before You Pay), `online`, `payment` (Enroll & Pay form), `faq` (includes
  `#refund-policy`), `location`, footer.
- **Dialogs:** `termsDlg` (Terms & Conditions, 16 sections), `loginDlg`, `editUserDlg`.
- **Account area** (`#acct`): `#acctStudent` (student page with "Message the school") and
  `#acctAdmin` (dashboard: Messages inbox, Accounts table, classes, enrollments). Which
  panels render depends on the user's permissions.

## Design rules

- **Palette ("Trustworthy Blue")**, defined as CSS variables in `:root`:
  background `#F7FAFC`, surface `#FFFFFF`, text `#0F172A`, secondary text `#475569`,
  primary `#1D4ED8` (buttons, links), hover `#1E40AF`, accent teal `#0F766E`,
  highlight gold `#EAB308`, border `#CBD5E1`. The old `--rust`/`--orange` variable names
  are aliases for the blues; keep using the variables, don't hardcode colors.
- Layout is modeled on alamocenter.org (top contact bar, white sticky header, dark hero,
  badge strip, numbered cards, "Made Simple" steps, review carousel). Light theme only.
- **Section backgrounds** are photos/images in `Media/` with a CSS overlay. When swapping
  one, check text contrast: dark images get white headings and gold labels with white
  cards on top; light images get dark text, often with a soft white fade behind the text.
- **Placeholders:** missing business details are wrapped in `<span class="ph">…</span>`
  (yellow highlight), and a "Draft preview" banner sits at the top. Remove a `.ph` span
  only when Glenn supplies the real value. The banner stays until launch.
- Must work on phones: the nav folds into a ☰ menu, the review carousel shows 3 cards on
  desktop/tablet and 1 on phones.

## Content rules

- **Never invent reviews or testimonials.** The carousel shows clearly marked placeholders
  until Glenn pastes real Google reviews into `CONFIG.reviews` (FTC rule on fake reviews).
- Don't invent business facts (prices, phone, address, TDLR provider number, fees,
  instructor bio). Leave a `.ph` placeholder and ask.
- Refund policy: all sales final, with a 30-day money back guarantee if the court or
  probation officer rejects the certificate, plus natural-disaster/technical-failure
  exceptions. Keep the FAQ answer, the schedule note, the enroll checkbox and Terms
  section 3 consistent when any of them changes.
- Terms & Conditions were drafted from the Alamo Center terms in our own wording; don't
  copy other schools' text verbatim. Students get one free reschedule.

## Supabase model

- **Tables:** `profiles` (one per auth user; `role`, `permissions`, legacy `is_admin`),
  `classes`, `enrollments` (payment and progress fields), `messages` (one conversation
  per student; `from_staff`, `read`).
- **Roles:** `student`, `instructor`, `staff`, `admin`.
  **Permissions:** `classes`, `students`, `payments`, `accounts`, `messages`. Admins
  always have all of them; students have none.
- **SQL helpers:** `my_role()`, `is_admin()`, `is_staff()`, `has_perm(p)`,
  `mark_messages_read(p_student)`. RLS policies and the `guard_enrollment_update`
  trigger enforce permissions in the database, so UI checks are only cosmetic.
- **`admin-users` Edge Function** (`POST`, actions `create` and `update`): the only path
  for creating accounts and changing someone's email, password, role or permissions.
  Rules it enforces: caller needs `accounts`; only an admin can create or edit an admin;
  nobody can change their own role or permissions.
- Both SQL scripts are written to be **safe to run more than once** (`if not exists`,
  `drop policy if exists`, `create or replace`). Keep new SQL that way.

### Changing the database

- Add schema or policy changes to a SQL script (append to `roles-setup.sql` or add a new
  numbered script), keep it idempotent, and explain each step in plain comments since
  Glenn may paste it into **Supabase → SQL Editor** himself.
- Applying SQL to the live database through the Supabase connector changes production and
  security rules; Glenn must approve it first. If the connector blocks it, give Glenn the
  file and step-by-step SQL Editor instructions.
- Deploying the Edge Function also changes production; confirm with Glenn first.

## Working with Glenn

- Reply in short, plain, non-technical language. Say what changed, where on the site to
  look, and that it'll be live in about a minute after it reaches `main`.
- Use the section names he sees on the page ("Why We're Called A Different Story",
  "Court Ordered DWI Classes", "3 Things to Check Before You Pay Anyone") rather than ids.
- When he sends an image for a background, save it into `Media/` with a descriptive
  kebab-case name (e.g. `schedule-classroom.jpg`), keep it reasonably small (most are
  under ~150 KB), and fix contrast as described above.
- Things still pending from Glenn: prices, Stripe or Square payment links, contact info,
  TDLR provider number, instructor bio and photo, real class dates, Google Business
  review link, custom domain.

## Before pushing

- Open `index.html` in a browser (Playwright/Chromium is available) and check the changed
  section at desktop and phone widths, plus the browser console for errors.
- Make sure no `Media/` file referenced in `index.html` is missing.
- Commit messages are short plain-English sentences, e.g. "Add refund policy".
