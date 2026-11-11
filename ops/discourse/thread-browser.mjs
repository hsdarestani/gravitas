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
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(site + "/latest", { waitUntil: "domcontentloaded" });
    await page.locator(".gq-forum-heading h1").waitFor({ timeout: 45000 });
    await page.locator(".topic-list a.title").first().click();
    const rail = page.locator(".gq-thread-rail");
    await rail.waitFor({ timeout: 45000 });
    await page.locator(".topic-post .cooked").first().waitFor();
    await page.locator("#topic-footer-buttons button.btn-primary").waitFor();
    assert.equal(new URL(page.url()).origin, site);
    assert.match(new URL(page.url()).pathname, /^\/t\//);
    assert.equal(await rail.locator(".gq-thread-facts dt").count(), 4);
    assert(await page.locator(".gq-thread-crumb").isVisible());
    assert(await page.locator(".gq-thread-byline").isVisible());
    await page.evaluate(() => document.fonts.ready);
    const layout = await page.evaluate(() => {
      const post = document.querySelector(".topic-post .cooked");
      const rail = document.querySelector(".gq-thread-rail");
      const container = document.querySelector(".container.posts");
      return {
        width: document.documentElement.scrollWidth,
        viewport: innerWidth,
        postLeft: post.getBoundingClientRect().left,
        postTop: post.getBoundingClientRect().top,
        railLeft: rail.getBoundingClientRect().left,
        railTop: rail.getBoundingClientRect().top,
        font: getComputedStyle(post).fontFamily,
        areas: getComputedStyle(container).gridTemplateAreas,
      };
    });
    assert(layout.width <= layout.viewport + 1, JSON.stringify(layout));
    assert(layout.font.includes("Literata"));
    if (name === "desktop") {
      assert(layout.railLeft > layout.postLeft);
      const next = rail.getByRole("button", { name: "Next post" });
      if (await next.isEnabled()) {
        const before = await rail.locator(".gq-thread-position").innerText();
        await next.click();
        await page.waitForFunction(previous =>
          document.querySelector(".gq-thread-position")?.textContent.trim() !== previous, before);
      }
    } else {
      assert(layout.railTop < layout.postTop, JSON.stringify(layout));
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/thread-${name}.png` });
    console.log(JSON.stringify({ browser: name, thread: new URL(page.url()).pathname, ...layout }));
  } finally {
    await browser.close();
  }
}
