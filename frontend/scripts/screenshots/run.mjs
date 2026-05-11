// Screenshot runner. Boots a Playwright Chromium instance, applies API mocks,
// then walks each scene under ./scenes/*.mjs and writes a PNG to ./output/.
//
// Usage:
//   npm run dev                          # start Vite (in another shell)
//   npm run screenshots                  # capture all scenes
//   npm run screenshots -- emails-path   # filter by name substring
//
// Env:
//   BASE_URL     — Vite dev server URL (default http://localhost:5173)
//   OUT          — output directory (default ./output)
//   COLOR_SCHEME — "dark" | "light" (default "dark")

import { chromium } from "playwright";
import { mkdir, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { attachMockApi } from "./mock-api.mjs";
import * as defaultFixtures from "./fixtures.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.env.BASE_URL ?? "http://localhost:5173";
const OUT = resolve(process.env.OUT ?? join(__dirname, "output"));
const COLOR_SCHEME = process.env.COLOR_SCHEME ?? "dark";
const filter = process.argv[2];

async function loadScenes() {
  const dir = join(__dirname, "scenes");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".mjs"));
  const all = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(join(dir, file)).href);
    const scenes = mod.default ?? [];
    const fixtures = mod.fixtures ?? null;
    for (const scene of scenes) {
      all.push({ ...scene, fixtures: fixtures ?? defaultFixtures, source: file });
    }
  }
  return all;
}

async function captureScene(browser, scene) {
  const ctx = await browser.newContext({
    viewport: scene.viewport ?? { width: 1400, height: 1100 },
    deviceScaleFactor: 2,
    colorScheme: scene.colorScheme ?? COLOR_SCHEME,
  });
  const page = await ctx.newPage();
  await attachMockApi(page, scene.fixtures);

  await page.goto(`${BASE_URL}${scene.path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  if (scene.prepare) await scene.prepare(page);
  await page.waitForTimeout(200);

  const target = scene.clip ? scene.clip(page) : page;
  const outPath = join(OUT, `${scene.name}.png`);
  await target.screenshot({ path: outPath });
  await ctx.close();
  return outPath;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const scenes = (await loadScenes()).filter(
    (s) => !filter || s.name.includes(filter),
  );
  if (scenes.length === 0) {
    console.error(filter ? `No scenes match "${filter}"` : "No scenes found.");
    process.exit(1);
  }

  console.log(`Capturing ${scenes.length} scene(s) to ${OUT}`);
  const browser = await chromium.launch();
  try {
    for (const scene of scenes) {
      try {
        const out = await captureScene(browser, scene);
        console.log(`  ✓ ${scene.name}.png`);
        void out;
      } catch (err) {
        console.error(`  ✗ ${scene.name} — ${err.message}`);
        process.exitCode = 1;
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
