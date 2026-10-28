// Renders every app icon from the repo's assets/icon.svg. Rerun after changing the mark or a
// variant color, and keep the colors in sync with app.config.ts.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import sharp from "sharp";

const mobileRoot = NodePath.resolve(import.meta.dirname, "..");
const source = NodeFS.readFileSync(NodePath.join(mobileRoot, "../../assets/icon.svg"), "utf8");
const BRAND_FILL = 'fill="#0891b2"';

const VARIANT_FILLS = {
  development: "#d97706",
  preview: "#7c3aed",
  production: "#0891b2",
} as const;

const render = (svg: string, file: string) =>
  sharp(Buffer.from(svg), { density: 1152 })
    .resize(1024, 1024)
    .png()
    .toFile(NodePath.join(mobileRoot, "assets", file));

if (!source.includes(BRAND_FILL)) throw new Error(`assets/icon.svg no longer uses ${BRAND_FILL}.`);

for (const [variant, fill] of Object.entries(VARIANT_FILLS)) {
  await render(source.replace(BRAND_FILL, `fill="${fill}"`), `icon-${variant}.png`);
}

// Android masks adaptive icons to the middle two thirds, so the mark keeps to that safe zone on a
// transparent canvas and the variant color comes from adaptiveIcon.backgroundColor.
const foreground = source
  .replace(/<rect[^>]*\/>/, "")
  .replace('viewBox="0 0 64 64"', 'viewBox="-16 -16 96 96"');

await render(foreground, "android-icon-foreground.png");

console.log("Wrote app icons to apps/mobile/assets.");
