# Building the A Different Story website with Glenn

Your job in this repo is to help **Glenn** build and grow the website for
**A Different Story**, his TDLR-licensed DWI school in Waco, Texas. Glenn is the owner,
not a developer. He describes what he wants in plain language, often by sending a
picture and naming a section, and he judges the result by looking at the live site.
Treat each request as "make this happen on the site, safely, and tell me where to look."

The school offers two court-ordered courses: **DWI Education** (12 hours, first
offense) and **DWI Intervention** (32 hours, repeat offense). The site lets students
enroll, log in to see their class, payment and certificate status, and message the
school. Staff manage classes, students, payments, accounts and messages from an admin
dashboard.

## The one rule that is never skipped

**Never publish without running the E2E checks and visually checking the change with
Playwright.** Publishing means pushing to `main` (or merging into it), because Netlify
puts `main` live within about a minute and there is no staging site.

Before every publish:

1. Run the E2E checks:
   ```
   NODE_PATH=$(npm root -g) node tests/e2e.cjs --only=<section-ids-you-changed>
   ```
   It serves the repo locally, drives the page in Chromium at desktop (1280px) and phone
   (390px) sizes, and fails on JavaScript errors, missing images, dead `#links`,
   sideways scrolling, a broken phone menu, Log In or Terms windows that don't open, an
   enroll form with no class dates or that submits empty, or an empty reviews carousel.
2. If anything fails, fix it and run again. Don't publish on a red run.
3. **Look at the screenshots** in `tests/screenshots/` (`desktop-full.png`,
   `phone-full.png`, plus one per section passed to `--only`). Open them and check the
   changed area with your own eyes: text readable on its background, nothing
   overlapping or cut off, images showing, layout right on the phone.
4. Only then push, and tell Glenn what you checked.

If you add a feature, add a check for it to `tests/e2e.cjs` in the same change.
Warnings about `cdn.jsdelivr.net` or `supabase.co` failing to load are expected in the
cloud sandbox (outside sites are blocked there); they are not failures. Login, messaging
and the admin dashboard need real Supabase accounts, so the E2E checks can't log in;
for changes there, also test on the Netlify deploy preview or ask Glenn to try it.

## How to help Glenn

- **Do the work, then show him.** Make the change, run the checks, publish, and reply
  with what changed and where on the page to look. Say it'll be live in about a minute.
- **Keep replies short and non-technical.** Use the section names he sees on the page
  ("Why We're Called A Different Story", "Court Ordered DWI Classes", "3 Things to
  Check Before You Pay Anyone"), not ids or file names.
- **When something needs him** (an answer, a Supabase step, a setting in Netlify),
  ask plainly and give exact click-by-click steps.
- **Ask, don't guess, for business facts.** Prices, phone, address, TDLR provider number,
  fees and his bio come from Glenn. Until then they stay as yellow placeholders.
- **Suggest the next step** when he asks "what's next". Still waiting on Glenn:
  prices, Stripe or Square payment links, contact info, TDLR provider number,
  instructor bio and photo, real class dates, Google Business review link, custom domain.
- **Explain trade-offs once, briefly**, and recommend one option (as when he asked about
  Wix or which login service to use).

## How the site is built

- **One static page.** Everything (HTML, CSS, JS) is in `index.html`. No build step, no
  framework, no package.json.
- **Hosting: Netlify**, linked to `main` with no build command and no publish directory.
  Pull requests get a Netlify deploy preview link.
- **Backend: Supabase** project `prvvivttwebyolfinjjj`
  (`https://prvvivttwebyolfinjjj.supabase.co`): logins, Postgres with row level
  security, live messages, and one Edge Function.
- Supabase JS is loaded from jsDelivr pinned at `@supabase/supabase-js@2.45.4`. Fonts
  are Poppins and Libre Baskerville from Google Fonts.

Netlify publishes the repo root as-is, so **every file in the repo can be downloaded
from the live site.** Never commit secrets. The Supabase publishable key in `CONFIG` is
meant to be public; the service role key must never appear in the repo or the browser.

### Files

| Path | What it is |
|---|---|
| `index.html` | The whole site: one `<style>` block, the markup, then the script with `CONFIG` at the top. |
| `Media/` | Images (section backgrounds, logo, favicon). `Media/brand/logo-original.jpg` is the original logo upload. |
| `tests/e2e.cjs` | The E2E and screenshot check. Screenshots land in `tests/screenshots/` (git-ignored). |
| `supabase-setup.sql` | First database setup: `profiles`, `classes`, `enrollments`, new-user trigger, security rules, starter classes. |
| `roles-setup.sql` | Roles and permissions, permission-aware security rules, enrollment update guard, `messages` table. |
| `supabase/functions/admin-users/index.ts` | Edge Function that creates and edits accounts (needs the service role key, so it runs on Supabase). |

A mirror of these files lives in the project's shared folder at
`/mnt/project-files/website/`. The repo is the source of truth; when you change a file,
copy it to the mirror too.

### Inside index.html

- **`CONFIG`** (top of the main `<script>`) holds the settings Glenn still has to fill
  in: `prices`, Stripe/Square `paymentLinks`, `formEndpoint`, `balanceLink`, `reviews`,
  `googleReviewLink`, the `supabase` URL and key, and the fallback `sessions` list.
- **Sections** in page order, by id: `home` (hero), `how`, `about`, `services`,
  `schedule`, `requirements` (What to Bring), `testimonials`, `verify` (3 Things to Check
  Before You Pay), `online`, `payment` (Enroll & Pay form), `faq` (includes
  `#refund-policy`), `location`, then the footer.
- **Windows:** `termsDlg` (Terms & Conditions, 16 sections), `loginDlg`, `editUserDlg`.
- **Account area** (`#acct`): `#acctStudent` (student page with "Message the school") and
  `#acctAdmin` (Messages inbox, Accounts table, classes, enrollments). Which panels show
  depends on the person's permissions.

## Design rules

- **Palette ("Trustworthy Blue")**, as CSS variables in `:root`: background `#F7FAFC`,
  surface `#FFFFFF`, text `#0F172A`, secondary text `#475569`, primary `#1D4ED8`
  (buttons, links), hover `#1E40AF`, teal accent `#0F766E`, gold highlight `#EAB308`,
  border `#CBD5E1`. The old `--rust`/`--orange` names are aliases for the blues. Use the
  variables; don't hardcode colors.
- Layout follows alamocenter.org: top contact bar, white sticky header, dark hero, badge
  strip, numbered cards, "Made Simple" steps, review carousel. Light theme only.
- **Section backgrounds** are images in `Media/` under a CSS overlay. When Glenn sends a
  new one, save it as a descriptive kebab-case file (e.g. `schedule-classroom.jpg`),
  keep it small (most are under ~150 KB), and fix contrast: on dark images use white
  headings, gold labels and white cards; on light images use dark text, often with a
  soft white fade behind it. Confirm it in the screenshots.
- **Placeholders:** missing details are wrapped in `<span class="ph">…</span>` (yellow),
  and a "Draft preview" banner sits at the top. Remove a placeholder only when Glenn
  gives the real value. The banner stays until launch.
- Must work on phones: the menu folds into ☰, and the reviews show 3 cards on desktop and
  tablet, 1 on phones.

## Content rules

- **Never invent reviews or testimonials.** The carousel shows marked placeholders until
  Glenn pastes real Google reviews into `CONFIG.reviews` (the FTC bans fake reviews).
- Refund policy: all sales final, a 30-day money back guarantee if the court or
  probation officer rejects the certificate, plus natural-disaster and technical-failure
  exceptions. Keep the FAQ answer, the schedule note, the enroll checkbox and Terms
  section 3 in agreement whenever one changes.
- Terms & Conditions were drafted from the Alamo Center terms in our own wording. Don't
  copy another school's text word for word. Students get one free reschedule.
- Suggest a lawyer review for legal text; you aren't one.

## Supabase

- **Tables:** `profiles` (one per login; `role`, `permissions`, legacy `is_admin`),
  `classes`, `enrollments` (payment and progress), `messages` (one conversation per
  student; `from_staff`, `read`).
- **Roles:** `student`, `instructor`, `staff`, `admin`. **Permissions:** `classes`,
  `students`, `payments`, `accounts`, `messages`. Admins have all; students have none.
- **SQL helpers:** `my_role()`, `is_admin()`, `is_staff()`, `has_perm(p)`,
  `mark_messages_read(p_student)`. The database's security rules and the
  `guard_enrollment_update` trigger enforce permissions, so hiding a button is only
  cosmetic.
- **`admin-users` Edge Function** (`POST`, actions `create` and `update`) is the only way
  to create accounts or change someone's email, password, role or permissions. Caller
  needs `accounts`; only an admin can create or edit an admin; nobody can change their
  own role or permissions.

### Changing the database

- Put changes in a SQL script (append to `roles-setup.sql` or add a new one). Keep it
  safe to run more than once (`if not exists`, `drop policy if exists`,
  `create or replace`) and comment each step in plain words, since Glenn may paste it
  into **Supabase → SQL Editor** himself.
- Running SQL on the live database or deploying the Edge Function changes production.
  Get Glenn's go-ahead first. If the Supabase connector blocks it, give him the file and
  click-by-click SQL Editor steps.

## Committing

- Commit messages are short plain-English sentences, e.g. "Add refund policy".
- Run the E2E and visual checks (above) before every push to `main`. No exceptions.
