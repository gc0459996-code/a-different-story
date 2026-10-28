// End-to-end and visual check for the site. Run before every push to main:
//   NODE_PATH=$(npm root -g) node tests/e2e.cjs   (screenshots go to tests/screenshots/)
//   NODE_PATH=$(npm root -g) node tests/e2e.cjs --only=faq,payment   (also screenshots just those sections)
// Serves the repo locally, drives index.html in Chromium at desktop and phone
// sizes, and exits non-zero if any check fails. Look at the screenshots after.
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

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  try {
    await run(browser, base, "desktop", { width: 1280, height: 800 });
    await run(browser, base, "phone", { width: 390, height: 844 });
  } finally {
    await browser.close();
    server.close();
  }
  if (warnings.length) console.log("\nWarnings (check these, usually blocked outside services):\n  " + [...new Set(warnings)].join("\n  "));
  console.log(`\nScreenshots: ${OUT}`);
  console.log(failures.length ? `\n${failures.length} check(s) FAILED. Do not publish.` : "\nAll checks passed. Now look at the screenshots before publishing.");
  process.exit(failures.length ? 1 : 0);
})();
