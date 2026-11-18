// End-to-end and visual check for the site. Run before every push to main:
//   NODE_PATH=$(npm root -g) node tests/e2e.cjs   (screenshots go to tests/screenshots/)
//   NODE_PATH=$(npm root -g) node tests/e2e.cjs --only=faq,payment   (also screenshots just those sections)
// Serves the repo locally, drives index.html in Chromium at desktop and phone
// sizes, and exits non-zero if any check fails. Look at the screenshots after.
// The "Edit site" checks swap the Supabase library for tests/supabase-mock.js, so they can
// log in as an admin and save changes without touching the real database.
const http = require("http");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "screenshots");
const only = (process.argv.find((a) => a.startsWith("--only=")) || "").slice(7).split(",").filter(Boolean);
const TYPES = { ".html": "text/html", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".css": "text/css", ".js": "text/javascript" };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]) === "/" ? "index.html" : decodeURIComponent(req.url.split("?")[0]));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});

const failures = [];
const warnings = [];
const check = (ok, msg) => { console.log(`${ok ? "  ok  " : "  FAIL"} ${msg}`); if (!ok) failures.push(msg); };

async function run(browser, base, name, viewport) {
  console.log(`\n${name} (${viewport.width}x${viewport.height})`);
  const page = await browser.newPage({ viewport });
  const pageErrors = [];
  const localMissing = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") warnings.push(`${name} console: ${m.text()}`); });
  page.on("response", (r) => { if (r.url().startsWith(base) && r.status() >= 400) localMissing.push(r.url().slice(base.length)); });
  page.on("requestfailed", (r) => { if (!r.url().startsWith(base)) warnings.push(`${name} external request failed: ${r.url()}`); });

  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForTimeout(800);

  // Every image used in markup or CSS backgrounds must load.
  const broken = await page.$$eval("img", (imgs) => imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.getAttribute("src")).map((i) => i.getAttribute("src")));
  const media = [...fs.readFileSync(path.join(ROOT, "index.html"), "utf8").matchAll(/Media\/[\w./-]+\.(?:jpe?g|png|svg|webp)/g)].map((m) => m[0]);
  const missingFiles = [...new Set(media)].filter((m) => !fs.existsSync(path.join(ROOT, m)));
  check(missingFiles.length === 0, `all referenced Media files exist${missingFiles.length ? ": " + missingFiles.join(", ") : ""}`);
  check(broken.length === 0, `all <img> load${broken.length ? ": " + broken.join(", ") : ""}`);

  // Every in-page link points at something that exists.
  const deadAnchors = await page.$$eval('a[href^="#"]', (as) => [...new Set(as.map((a) => a.getAttribute("href")))]
    .filter((h) => h.length > 1 && !["#login", "#terms"].includes(h) && !document.getElementById(h.slice(1))));
  check(deadAnchors.length === 0, `all #links have a target${deadAnchors.length ? ": " + deadAnchors.join(", ") : ""}`);

  // No sideways scrolling.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, `no horizontal scroll (overflow ${overflow}px)`);

  // Mobile menu.
  if (viewport.width <= 900 && await page.isVisible("#menuBtn")) {
    await page.click("#menuBtn");
    check(await page.getAttribute("#menuBtn", "aria-expanded") === "true", "phone menu opens");
    await page.click("#menuBtn");
  }

  // Log In dialog.
  if (viewport.width <= 900 && await page.isVisible("#menuBtn")) await page.click("#menuBtn");
  await page.click("#loginOpen");
  check(await page.isVisible("#loginDlg"), "Log In window opens");
  await page.click("#loginClose");
  check(!(await page.isVisible("#loginDlg")), "Log In window closes");

  // Terms & Conditions dialog.
  await page.click("#termsOpen");
  check(await page.isVisible("#termsDlg"), "Terms & Conditions opens");
  await page.click("#termsClose");

  // Enroll form has class dates and blocks an empty submit.
  check(await page.$$eval("#session option", (o) => o.length) > 0, "enroll form lists class dates");
  const valid = await page.$eval("#enrollForm", (f) => f.checkValidity());
  check(!valid, "empty enroll form is not submittable");

  // Reviews carousel renders cards.
  check(await page.$$eval("#rTrack > *", (c) => c.length) > 0, "reviews carousel has cards");

  check(pageErrors.length === 0, `no JavaScript errors${pageErrors.length ? ": " + pageErrors.join(" | ") : ""}`);
  check(localMissing.length === 0, `no missing local files${localMissing.length ? ": " + localMissing.join(", ") : ""}`);

  // Screenshots for the visual check.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, `${name}-full.png`), fullPage: true });
  // Unstick the header so it doesn't cover the top of section screenshots.
  await page.addStyleTag({ content: ".header,.topbar{position:static!important}" });
  for (const id of only) {
    const el = await page.$(`#${id}`);
    if (el) await el.screenshot({ path: path.join(OUT, `${name}-${id}.png`) });
    else check(false, `section #${id} exists for screenshot`);
  }
  await page.close();
}

// A pretend database for the Edit site checks.
const mockDb = (siteContent = []) => ({
  profiles: [
    { id: "u-admin", email: "admin@test.local", full_name: "Test Admin", role: "admin", permissions: [], created_at: "2026-01-01T00:00:00Z" },
    { id: "u-staff", email: "staff@test.local", full_name: "Test Staff", role: "staff", permissions: ["classes", "students", "payments", "messages"], created_at: "2026-01-01T00:00:00Z" }
  ],
  classes: [
    { id: 1, course: "education", dates: "Mon–Wed, Jan 5–7", times: "6:00–10:00 pm", location: "Live online (Zoom)", sessions: 3, seats: 16, status: "open" },
    { id: 2, course: "intervention", dates: "Tue & Thu, starts Jan 6", times: "6:00–9:00 pm", location: "Live online (Zoom)", sessions: 11, seats: 12, status: "open" },
    { id: 3, course: "education", dates: "Old closed class", times: "9:00 am–1:00 pm", location: "Live online (Zoom)", sessions: 3, seats: 16, status: "closed" }
  ],
  enrollments: [], messages: [], site_content: siteContent
});

async function mockPage(browser, base, viewport, db) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.dismiss());
  await page.route("https://cdn.jsdelivr.net/npm/@supabase/**", (r) => r.fulfill({ contentType: "text/javascript", body: fs.readFileSync(path.join(__dirname, "supabase-mock.js")) }));
  await page.route("https://mock-storage.test/**", (r) => r.fulfill({ contentType: "image/jpeg", body: fs.readFileSync(path.join(ROOT, "Media/hero-classroom.jpg")) }));
  await page.route("https://fonts.googleapis.com/**", (r) => r.abort());
  await page.addInitScript((d) => { window.__mockDb = d; }, db);
  await page.goto(base + "/", { waitUntil: "load" });
  await page.waitForTimeout(300);
  return { page, errors };
}
async function logIn(page, email, viewport) {
  if (viewport.width <= 900 && await page.isVisible("#menuBtn")) await page.click("#menuBtn");
  await page.click("#loginOpen");
  await page.fill("#loginForm input[name=email]", email);
  await page.fill("#loginForm input[name=password]", "password123");
  await page.click("#loginSubmit");
  await page.waitForSelector("#acct:not([hidden])");
  await page.waitForTimeout(200);
}

async function siteEditorRun(browser, base, name, viewport) {
  console.log(`\n${name} Edit site (${viewport.width}x${viewport.height}, pretend database)`);

  // Visitors see saved content; anything not saved keeps the built-in text.
  let { page, errors } = await mockPage(browser, base, viewport, mockDb([
    { key: "phone", value: "(254) 555-0100" }, { key: "price_intervention", value: 350 },
    { key: "faqs", value: [{ q: "Saved question?", a: "Saved answer.\n\nSecond paragraph." }] }
  ]));
  check(await page.$$eval('[data-site="phone"]', (els) => els.every((e) => e.textContent === "(254) 555-0100" && !e.classList.contains("ph"))), "saved phone shows everywhere, without the placeholder highlight");
  check(await page.$$eval('[data-site="email"]', (els) => els.every((e) => e.classList.contains("ph"))), "unsaved email keeps its placeholder");
  check(await page.textContent("#home h1") === "Need a DWI Class in Waco, Texas?", "unsaved headline keeps the built-in text");
  check(await page.$$eval('[data-site="price_intervention"]', (els) => els.length > 0 && els.every((e) => e.textContent === "$350")), "saved price shows on the class card");
  check(await page.$$eval("#faqList details", (d) => d.length === 2 && d[0].querySelector("summary").textContent === "Saved question?" && d[0].querySelectorAll("p").length === 2 && d[1].id === "refund-policy"), "saved FAQs replace the built-in ones and the refund question stays last");
  check(await page.$$eval("#schedRows tr", (r) => r.length === 2 && r[1].textContent.includes("starts Jan 6") && r[1].textContent.includes("$350")), "schedule lists only open classes from the database, with prices");
  check(!(await page.isVisible("#acctEditSite")), "Edit site button hidden from visitors");
  await page.close();

  // Staff who aren't admins don't get the Edit site page.
  ({ page, errors } = await mockPage(browser, base, viewport, mockDb()));
  await logIn(page, "staff@test.local", viewport);
  check(!(await page.isVisible("#acctEditSite")), "Edit site button hidden from non-admin staff");
  await page.close();

  // An admin edits and saves, and the page updates right away.
  ({ page, errors } = await mockPage(browser, base, viewport, mockDb()));
  await logIn(page, "admin@test.local", viewport);
  check(await page.isVisible("#acctEditSite"), "Edit site button shows for an admin");
  await page.click("#acctEditSite");
  await page.waitForSelector("#acctSite form[data-card=hero]");
  check(await page.isVisible("#acctSite"), "Edit site page opens");
  check(await page.inputValue("#acctSite [name=hero_title]") === "Need a DWI Class in Waco, Texas?", "headline field starts with the current text");
  const save = async (card) => { await page.click(`#acctSite form[data-card=${card}] button[type=submit]`); await page.waitForSelector(`#acctSite form[data-card=${card}] .lmsg.show`); return page.textContent(`#acctSite form[data-card=${card}] .lmsg`); };
  await page.fill("#acctSite [name=hero_title]", "DWI Classes in Waco, Made Simple");
  check(/live/.test(await save("hero")), "headline saves");
  await page.fill("#acctSite [name=phone]", "(254) 555-0199");
  await page.fill("#acctSite [name=email]", "not-an-email");
  check(/valid email/.test(await save("contact")), "a bad email is refused");
  await page.fill("#acctSite [name=email]", "info@example.com");
  await page.fill("#acctSite [name=office_hours]", "Mon–Fri, 10 am–6 pm");
  await page.fill("#acctSite [name=tdlr]", "12345");
  check(/live/.test(await save("contact")), "contact details save");
  await page.fill("#acctSite [name=price_education]", "-5");
  check(/number above 0/.test(await save("prices")), "a bad price is refused");
  await page.fill("#acctSite [name=price_education]", "125");
  check(/live/.test(await save("prices")), "prices save");
  await page.fill("#acctSite [data-class-id='1'] [data-f=dates]", "Mon–Wed, Feb 2–4");
  await page.click("#siteAddClass");
  await page.fill("#acctSite [data-class-id=''] [data-f=dates]", "Sat, Feb 14, 21, 28");
  await page.fill("#acctSite [data-class-id=''] [data-f=times]", "9:00 am–1:00 pm");
  check(/live/.test(await save("schedule")), "class schedule saves");
  await page.fill("#acctSite [data-faq] input >> nth=0", "Which DWI class do I need?");
  check(/live/.test(await save("faq")), "FAQs save");
  await page.setInputFiles("#acctSite [data-photo=home] input[type=file]", path.join(ROOT, "Media/about-wave.jpg"));
  await page.waitForSelector("#acctSite [data-photo=home] .lmsg.ok", { timeout: 10000 });
  check(await page.$eval("#acctSite [data-photo=home]", (c) => c.textContent.includes("Your photo")), "a new section photo uploads");
  const uploads = await page.evaluate(() => window.__mockDb.__uploads);
  check(uploads.length === 1 && uploads[0].type === "image/jpeg", "uploaded photo is saved as a JPEG");
  const overflow = await page.$eval("#acct", (a) => a.scrollWidth - a.clientWidth);
  check(overflow <= 1, `Edit site page has no sideways scroll (overflow ${overflow}px)`);
  await page.addStyleTag({ content: ".acct{position:static!important;overflow:visible!important}" });
  await (await page.$("#acct")).screenshot({ path: path.join(OUT, `${name}-edit-site.png`) });
  await page.addStyleTag({ content: ".acct{position:fixed!important;overflow-y:auto!important}" });

  // Back on the website, every change is already showing.
  await page.click("#acctBack");
  check(await page.textContent("#home h1") === "DWI Classes in Waco, Made Simple", "new headline is live");
  check(await page.$$eval('[data-site="phone"]', (els) => els.length >= 5 && els.every((e) => e.textContent === "(254) 555-0199")), "new phone is live everywhere");
  check(await page.$$eval('[data-site="tdlr"]', (els) => els.every((e) => e.textContent === "#12345")), "TDLR number is live everywhere");
  check(await page.$$eval('[data-site="price_education"]', (els) => els.every((e) => e.textContent === "$125")), "new price is live");
  check(await page.textContent("#totalAmt") === "$125.00", "enroll form total uses the new price");
  check(await page.$$eval("#schedRows tr", (r) => r.length === 3 && r[0].textContent.includes("Feb 2–4") && r[2].textContent.includes("Feb 14")), "schedule changes are live");
  check(await page.$$eval("#session option", (o) => o.some((x) => x.textContent.includes("Feb 14"))), "new class is in the enroll form");
  check(await page.textContent("#faqList details summary") === "Which DWI class do I need?", "FAQ change is live");
  check(await page.$eval("#home", (h) => h.style.getPropertyValue("--bg-img").includes("mock-storage.test")), "new top photo is live");

  // Clearing a field puts the original back.
  if (viewport.width <= 900 && await page.isVisible("#menuBtn")) await page.click("#menuBtn");
  await page.click("#loginOpen");
  await page.click("#acctEditSite");
  await page.waitForSelector("#acctSite form[data-card=contact]");
  await page.fill("#acctSite [name=phone]", "");
  await save("contact");
  await page.click("#acctSite [data-photo=home] [data-photo-reset]");
  await page.waitForSelector("#acctSite [data-photo=home]:not(:has([data-photo-reset]))");
  await page.click("#acctBack");
  check(await page.$$eval('[data-site="phone"]', (els) => els.every((e) => e.classList.contains("ph"))), "clearing the phone brings back the placeholder");
  check(await page.$eval("#home", (h) => !h.style.getPropertyValue("--bg-img")), "Use the original photo brings back the built-in photo");
  check(errors.length === 0, `no JavaScript errors on the Edit site page${errors.length ? ": " + errors.join(" | ") : ""}`);
  await page.close();
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await run(browser, base, "desktop", { width: 1280, height: 800 });
    await run(browser, base, "phone", { width: 390, height: 844 });
    await siteEditorRun(browser, base, "desktop", { width: 1280, height: 800 });
    await siteEditorRun(browser, base, "phone", { width: 390, height: 844 });
  } finally {
    await browser.close();
    server.close();
  }
  if (warnings.length) console.log("\nWarnings (check these, usually blocked outside services):\n  " + [...new Set(warnings)].join("\n  "));
  console.log(`\nScreenshots: ${OUT}`);
  console.log(failures.length ? `\n${failures.length} check(s) FAILED. Do not publish.` : "\nAll checks passed. Now look at the screenshots before publishing.");
  process.exit(failures.length ? 1 : 0);
})();
