// App icons from the crest (scripts/crest.mjs → public/icons/crest.svg): rendered by sharp at each size.
// The maskable icon keeps the crest inside Android's safe circle (radius 40 %); the favicon crops close so 32 px stays legible.
import sharp from "sharp";
import fs from "node:fs";
const svg = fs.readFileSync("public/icons/crest.svg", "utf8");
const BG = "#15120d";
const view = (vb) => Buffer.from(svg.replace(/viewBox="[^"]+"/, `viewBox="${vb}"`).replace(/<rect x="-12" y="-12" width="124" height="124"/, `<rect x="-60" y="-60" width="220" height="220"`));
for (const [name, size, vb] of [["icon-192.png", 192, "-12 -12 124 124"], ["icon-512.png", 512, "-12 -12 124 124"], ["apple-touch-icon.png", 180, "-12 -12 124 124"], ["maskable-512.png", 512, "-22 -22 144 144"], ["favicon-32.png", 32, "-3 -3 106 106"]]) {
  await sharp(view(vb), { density: Math.max(72, (72 * size) / 100) }).resize(size, size).flatten({ background: BG }).png().toFile("public/icons/" + name);
}
console.log("icons ok");
