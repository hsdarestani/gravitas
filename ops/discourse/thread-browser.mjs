import assert from "node:assert/strict";
import fs from "node:fs/promises";

const { chromium, webkit, devices } = await import(process.env.PLAYWRIGHT_MODULE);
const output = process.env.GQ_BROWSER_OUTPUT;
const site = "https://forum.graviquest.com";
await fs.mkdir(output, { recursive: true });

const browsers = [
  { engine: chromium, name: "desktop", options: { viewport: { width: 1440, height: 1000 } } },
  { engine: chromium, name: "android", options: devices["Pixel 7"] },
  { engine: webkit, name: "ios", options: devices["iPhone 13"] },
];

for (const { engine, name, options } of browsers) {
  const browser = await engine.launch();
  try {
    const page = await browser.newPage(options);
    const errors = [];
    // Discourse keeps a message-bus long poll open on every page. When the
    // test navigates away, WebKit reports the aborted poll as a page error
    // ("…/message-bus/…/poll due to access control checks."), which failed
    // the iOS run on 2026-11-22 with the thread and profile otherwise passing.
    // That one message is the browser cancelling a request, not the page
    // failing; every other error still counts.
    page.on("pageerror", error => {
      if (/\/message-bus\/[^/]+\/poll due to access control checks/.test(error.message)) return;
      errors.push(error.message);
    });
    // The front page (forum-home.gjs): a chip per room, in the
    // order of backend/core/forum_rooms.json, and every thread in one table.
    await page.goto(site + "/latest", { waitUntil: "domcontentloaded" });
    await page.locator(".gq-forum-home h1").waitFor({ timeout: 45000 });
    const rooms = JSON.parse(await fs.readFile(new URL("../../backend/core/forum_rooms.json", import.meta.url), "utf8"));
    const listed = rooms.rooms.map(room => room.slug);
    const shown = await page.locator(".gq-chips a.gq-chip[data-room]").evaluateAll(links =>
      links.map(link => link.dataset.room));
    assert.deepEqual(shown, listed);
    await page.locator(".topic-list a.title").filter({ visible: true }).first().waitFor({ timeout: 45000 });
    assert(await page.locator(".gq-search input[name=q]").isVisible());
    assert(await page.locator(".gq-week a.gq-week__link").isVisible());
    assert(await page.locator(".gq-rules li").count() === 4);
    await page.locator('.gq-chips a.gq-chip[data-room="ai-in-research"]').click();
    await page.locator(".gq-room__title").waitFor({ timeout: 45000 });
    // The room's "About the … category" row is first in the list but hidden
    // by common.scss; open the first thread a reader can actually see.
    await page.locator(".topic-list a.title").filter({ visible: true }).first().click();
    // Nested replies (on since 2026-11-19) draw the thread with their own
    // components and float Reply; the flat thread keeps it in the footer box,
    // so the check accepts either.
    await page.locator(":is(.topic-post, .nested-view__op-article, .nested-post__article) .cooked").first().waitFor({ timeout: 45000 });
    await page.locator("#topic-footer-buttons button.btn-primary, .nested-view__floating-reply").filter({ visible: true }).first().waitFor();
    assert.equal(new URL(page.url()).origin, site);
    assert.match(new URL(page.url()).pathname, /^\/t\//);
    // One column: the breadcrumb, the posts and the reply box; no rail beside
    // the posts and no byline repeating the opening post's header.
    assert(await page.locator(".gq-thread-crumb").isVisible());
    assert.equal(await page.locator(".gq-thread-rail").count(), 0);
    assert.equal(await page.locator(".gq-thread-byline").count(), 0);
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const post = document.querySelector(":is(.topic-post, .nested-view__op-article, .nested-post__article) .cooked").getBoundingClientRect();
      const stream = document.querySelector(".nested-view, .container.posts").getBoundingClientRect();
      return {
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        postLeft: post.left,
        postRight: post.right,
        streamLeft: stream.left,
        font: getComputedStyle(document.querySelector(":is(.topic-post, .nested-view__op-article, .nested-post__article) .cooked")).fontFamily,
      };
    });
    assert(layout.width <= layout.viewport + 1, JSON.stringify(layout));
    assert(layout.font.includes("Literata"));
    if (name === "desktop") {
      // Centred: the column has as much room on its right as on its left.
      assert(Math.abs(layout.viewport - layout.postRight - layout.streamLeft) < layout.viewport * 0.2, JSON.stringify(layout));
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/thread-${name}.png` });
    console.log(JSON.stringify({ browser: name, thread: new URL(page.url()).pathname, ...layout }));

    await page.goto(site + "/u/system/summary", { waitUntil: "domcontentloaded" });
    const profileNav = page.locator(".user-navigation-primary");
    for (const view of ["Activity", "Summary"]) {
      const route = view.toLowerCase();
      const tab = profileNav.locator(`a[href="/u/system/${route}"]`);
      try {
        await tab.click({ timeout: 15000 });
        await page.waitForURL(site + "/u/system/" + route);
        await tab.and(page.locator(".active")).waitFor({ timeout: 10000 });
        await tab.getByText(view, { exact: true }).waitFor({ timeout: 10000 });
      } catch (error) {
        console.log(JSON.stringify({
          browser: name,
          path: new URL(page.url()).pathname,
          title: await page.title(),
          layout: await page.evaluate(() => ({
            htmlClass: document.documentElement.className,
            bodyClass: document.body.className,
          })),
          links: await profileNav.locator("a").evaluateAll(links => links.map(link => ({
            path: link.getAttribute("href"),
            text: link.textContent.trim(),
            visible: link.getClientRects().length > 0,
            label: link.querySelector("span")?.getClientRects().length,
            labelDisplay: link.querySelector("span") && getComputedStyle(link.querySelector("span")).display,
          }))),
          errors,
        }));
        await page.screenshot({ path: `${output}/profile-failure-${name}.png` });
        throw error;
      }
    }
    await page.getByRole("heading", { name: "Stats", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ browser: name, profileNavigation: "passed" }));
  } finally {
    await browser.close();
  }
}
