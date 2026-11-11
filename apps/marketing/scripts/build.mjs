import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceDir = join(appDir, "src");
const outputDir = join(appDir, "dist");
const assetDir = join(outputDir, "assets");
const sourceAssets = join(sourceDir, "assets");
const assetNames = [
  "shopro-logo.webp",
  "vazirmatn-arabic-400.woff2",
  "vazirmatn-arabic-700.woff2",
  "vazirmatn-latin-400.woff2",
  "vazirmatn-latin-700.woff2",
];

await rm(outputDir, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });

const assets = {};
for (const name of assetNames) {
  const sourcePath = join(sourceAssets, name);
  const contents = await readFile(sourcePath);
  const digest = createHash("sha256").update(contents).digest("hex").slice(0, 12);
  const outputName = basename(name).replace(/\.(webp|woff2)$/, "." + digest + ".$1");
  const outputPath = "/assets/" + outputName;
  assets[name] = outputPath;
  await writeFile(join(assetDir, outputName), contents);
}

const styles = (await readFile(join(sourceDir, "styles.css"), "utf8")) + "\n" + (await readFile(join(sourceDir, "visual-refresh.css"), "utf8"));
const script = await readFile(join(sourceDir, "landing.js"), "utf8");
const renderedStyles = styles
  .replaceAll("__SHOPRO_FONT_ARABIC_400_PATH__", assets["vazirmatn-arabic-400.woff2"])
  .replaceAll("__SHOPRO_FONT_ARABIC_700_PATH__", assets["vazirmatn-arabic-700.woff2"])
  .replaceAll("__SHOPRO_FONT_LATIN_400_PATH__", assets["vazirmatn-latin-400.woff2"])
  .replaceAll("__SHOPRO_FONT_LATIN_700_PATH__", assets["vazirmatn-latin-700.woff2"]);
const unresolvedStyle = renderedStyles.match(/__SHOPRO_[A-Z0-9_]+__/g);
if (unresolvedStyle) throw new Error("Unresolved stylesheet placeholder: " + unresolvedStyle.join(", "));
const styleDigest = createHash("sha256").update(renderedStyles).digest("hex").slice(0, 12);
const scriptDigest = createHash("sha256").update(script).digest("hex").slice(0, 12);
const styleName = "landing." + styleDigest + ".css";
const scriptName = "landing." + scriptDigest + ".js";

await writeFile(join(assetDir, styleName), renderedStyles);
await writeFile(join(assetDir, scriptName), script);
await writeFile(join(outputDir, "Vazirmatn-OFL.txt"), await readFile(join(sourceAssets, "Vazirmatn-OFL.txt")));

const index = (await readFile(join(sourceDir, "index.html"), "utf8"))
  .replaceAll("__SHOPRO_LOGO_PATH__", assets["shopro-logo.webp"])
  .replaceAll("__SHOPRO_FONT_ARABIC_400_PATH__", assets["vazirmatn-arabic-400.woff2"])
  .replaceAll("__SHOPRO_STYLESHEET_PATH__", "/assets/" + styleName)
  .replaceAll("__SHOPRO_SCRIPT_PATH__", "/assets/" + scriptName);

for (const [name, content] of [["index.html", index], ["robots.txt", await readFile(join(sourceDir, "robots.txt"), "utf8")], ["sitemap.xml", await readFile(join(sourceDir, "sitemap.xml"), "utf8")]]) {
  const unresolved = content.match(/__SHOPRO_(?!PUBLIC_URL__|PRODUCT_APP_URL__)[A-Z0-9_]+__/g);
  if (unresolved) throw new Error("Unresolved build placeholder in " + name + ": " + unresolved.join(", "));
  await writeFile(join(outputDir, name), content);
}

const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else files.push(relative(outputDir, path).split(sep).join("/"));
  }
}
await collect(outputDir);
console.log("Built Shopro marketing site: " + files.length + " files, " + (await Promise.all(files.map(async (file) => (await readFile(join(outputDir, file))).byteLength))).reduce((total, length) => total + length, 0) + " bytes.");
