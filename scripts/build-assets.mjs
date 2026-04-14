import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { transform } from "lightningcss";
import { PurgeCSS } from "purgecss";
import sharp from "sharp";

const root = process.cwd();
const cssSource = path.join(root, "public", "assets", "css", "style.css");
const cssTarget = path.join(root, "public", "assets", "css", "style.min.css");
const avatarSource = path.join(root, "public", "assets", "avatar.jpg");
const avatarTarget = path.join(root, "public", "assets", "avatar.webp");

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function collectFiles(dir, extensions, acc = []) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(fullPath, extensions, acc);
      continue;
    }
    if (extensions.includes(path.extname(entry.name))) {
      acc.push(fullPath);
    }
  }
  return acc;
}

async function buildCss() {
  const contentFiles = await Promise.all([
    collectFiles(path.join(root, "src"), [".ts"]),
    collectFiles(path.join(root, "public"), [".html", ".js"]),
  ]).then((parts) => parts.flat());

  const purge = await new PurgeCSS().purge({
    content: contentFiles,
    css: [cssSource],
    safelist: [
      "active",
      "visible",
      "revealed",
      "copied",
      "is-active",
      "has-cover",
      "no-img",
      "theme-transition-overlay",
      "hljs",
      /^hljs-/,
    ],
  });

  const code = Buffer.from(purge[0]?.css || (await readFile(cssSource)).toString("utf8"));
  const result = transform({
    filename: cssSource,
    code,
    minify: true,
    sourceMap: false,
  });

  await mkdir(path.dirname(cssTarget), { recursive: true });
  await writeFile(cssTarget, result.code);

  const sourceSize = (await stat(cssSource)).size;
  const targetSize = (await stat(cssTarget)).size;
  const reduction = sourceSize > 0 ? (((sourceSize - targetSize) / sourceSize) * 100).toFixed(1) : "0.0";

  console.log(`CSS: ${formatSize(sourceSize)} -> ${formatSize(targetSize)} (${reduction}% smaller)`);
}

async function buildAvatar() {
  await sharp(avatarSource)
    .rotate()
    .webp({ quality: 82, effort: 6 })
    .toFile(avatarTarget);

  const sourceSize = (await stat(avatarSource)).size;
  const targetSize = (await stat(avatarTarget)).size;
  const reduction = sourceSize > 0 ? (((sourceSize - targetSize) / sourceSize) * 100).toFixed(1) : "0.0";

  console.log(`Avatar: ${formatSize(sourceSize)} -> ${formatSize(targetSize)} (${reduction}% smaller)`);
}

await buildCss();
await buildAvatar();
