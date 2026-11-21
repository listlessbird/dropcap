// Renders every app icon from the layer SVGs in the repo's assets/. Rerun after changing a layer or a
// variant color, and keep the colors in sync with app.config.ts.
//
// All layers share Android's 108 dp adaptive canvas, so they stack without scaling. Production gets
// the full art; dev and preview get the flat mark on their variant color.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import sharp from "sharp";

const mobileRoot = NodePath.resolve(import.meta.dirname, "..");

// The markup inside a layer's <svg> root, so layers can be stacked in one document.
const layer = (name: string) =>
  NodeFS.readFileSync(NodePath.join(mobileRoot, "../../assets", `icon-${name}.svg`), "utf8")
    .replace(/^\s*<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");

const background = layer("background");
const foreground = layer("foreground");
const mark = layer("mark");

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108">${body}</svg>`;

const render = (body: string, file: string) =>
  sharp(Buffer.from(svg(body)), { density: 1024 })
    .resize(1024, 1024)
    .png()
    .toFile(NodePath.join(mobileRoot, "assets", file));

const FLAT_VARIANTS = { development: "#d97706", preview: "#7c3aed" } as const;

await render(background + foreground, "icon-production.png");

for (const [variant, color] of Object.entries(FLAT_VARIANTS)) {
  await render(
    `<rect width="108" height="108" fill="${color}"/><g fill="#ffffff">${mark}</g>`,
    `icon-${variant}.png`,
  );
}

await render(background, "android-icon-background.png");

await render(foreground, "android-icon-foreground.png");

// Android reads only the monochrome layer's alpha, so the dev and preview foreground can share it.
await render(`<g fill="#ffffff">${mark}</g>`, "android-icon-mark.png");

console.log("Wrote app icons to apps/mobile/assets.");
