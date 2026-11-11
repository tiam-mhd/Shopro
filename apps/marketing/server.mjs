import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(fileURLToPath(new URL(".", import.meta.url)));
const distDir = resolve(appDir, "dist");
const portText = process.env.PORT || "8080";
const port = Number(portText);

if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer from 1 to 65535.");
}

function publicOrigin(value, variable, fallback) {
  const text = (value || fallback).trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(variable + " must be a complete http or https origin.");
  }
  if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
    throw new Error(variable + " must be an origin such as https://example.com without a path or credentials.");
  }
  return parsed.origin;
}

const siteOrigin = publicOrigin(process.env.PUBLIC_URL, "PUBLIC_URL", "http://localhost:" + port);
const productOrigin = publicOrigin(process.env.PRODUCT_URL, "PRODUCT_URL", "https://shoproapp.ir");
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

function applyHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("X-Frame-Options", "DENY");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function send(response, status, type, body, cacheControl, method) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(body);
  applyHeaders(response);
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": data.byteLength,
    "Cache-Control": cacheControl,
  });
  response.end(method === "HEAD" ? undefined : data);
}

const server = createServer(async (request, response) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD");
    send(response, 405, "text/plain; charset=utf-8", "Method not allowed", "no-store", request.method);
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || "/", "http://shopro.local").pathname);
  } catch {
    send(response, 400, "text/plain; charset=utf-8", "Bad request", "no-store", request.method);
    return;
  }

  if (pathname === "/healthz") {
    send(response, 200, "text/plain; charset=utf-8", "ok\n", "no-store", request.method);
    return;
  }

  if (pathname === "/") pathname = "/index.html";
  const relativePath = pathname.replace(/^\/+/, "");
  const target = resolve(distDir, relativePath);
  const normalizedRoot = distDir.toLowerCase() + sep;
  if (target.toLowerCase() !== distDir.toLowerCase() && !target.toLowerCase().startsWith(normalizedRoot)) {
    send(response, 400, "text/plain; charset=utf-8", "Bad request", "no-store", request.method);
    return;
  }

  const type = contentTypes.get(extname(target).toLowerCase());
  if (!type) {
    send(response, 404, "text/plain; charset=utf-8", "Not found", "no-store", request.method);
    return;
  }

  let body;
  try {
    body = await readFile(target);
  } catch {
    send(response, 404, "text/plain; charset=utf-8", "Not found", "no-store", request.method);
    return;
  }

  if (pathname === "/index.html" || pathname === "/robots.txt" || pathname === "/sitemap.xml") {
    body = body.toString("utf8").replaceAll("__SHOPRO_PUBLIC_URL__", siteOrigin);
    if (pathname === "/index.html") body = body.replaceAll("__SHOPRO_PRODUCT_APP_URL__", productOrigin + "/app");
  }

  const immutableAsset = /^\/assets\/[a-z0-9-]+\.[a-f0-9]{12}\.(?:css|js|webp|woff2)$/i.test(pathname);
  const cacheControl = pathname === "/index.html" || pathname === "/robots.txt" || pathname === "/sitemap.xml"
    ? "no-cache"
    : immutableAsset ? "public, max-age=31536000, immutable" : "no-cache";
  send(response, 200, type, body, cacheControl, request.method);
});

server.listen(port, "0.0.0.0", () => {
  console.log("Shopro marketing site listening on 0.0.0.0:" + port + " (" + siteOrigin + ")");
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
