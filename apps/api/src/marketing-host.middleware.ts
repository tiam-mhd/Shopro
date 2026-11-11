import { readFile } from "node:fs/promises";
import express, { type RequestHandler } from "express";
import { resolve } from "node:path";

type MarketingHostOptions = {
  publicUrl: string;
  productUrl: string;
  allowedOrigins: string[];
  staticRoot: string;
  httpsOnly: boolean;
};

export async function createMarketingHostMiddleware(options: MarketingHostOptions): Promise<RequestHandler> {
  const marketingUrl = parseOrigin(options.publicUrl, "MARKETING_PUBLIC_URL", options.httpsOnly);
  const origins = options.allowedOrigins.map((origin) => parseOrigin(origin, "WEB_ORIGIN", options.httpsOnly).origin);
  if (origins.includes(marketingUrl.origin)) {
    throw new Error("MARKETING_PUBLIC_URL باید از WEB_ORIGIN جدا باشد تا دامنهٔ محصول و لندینگ با هم اشتباه نشوند.");
  }
  const productOrigin = parseOrigin(options.productUrl, "PRODUCT_URL", options.httpsOnly).origin;
  const staticRoot = resolve(options.staticRoot);
  const [page, robots, sitemap] = await Promise.all([
    readFile(resolve(staticRoot, "index.html"), "utf8"),
    readFile(resolve(staticRoot, "robots.txt"), "utf8"),
    readFile(resolve(staticRoot, "sitemap.xml"), "utf8"),
  ]);
  const renderedPage = page.replaceAll("__SHOPRO_PUBLIC_URL__", marketingUrl.origin).replaceAll("__SHOPRO_PRODUCT_APP_URL__", productOrigin + "/app");
  const renderedRobots = robots.replaceAll("__SHOPRO_PUBLIC_URL__", marketingUrl.origin);
  const renderedSitemap = sitemap.replaceAll("__SHOPRO_PUBLIC_URL__", marketingUrl.origin);
  const staticAssets = express.static(staticRoot, {
    index: false,
    fallthrough: true,
    setHeaders: (response) => response.setHeader("Cache-Control", "public, max-age=31536000, immutable"),
  });

  return (request, response, next) => {
    if (request.hostname.toLowerCase() !== marketingUrl.hostname.toLowerCase()) {
      next();
      return;
    }
    response.vary("Host");
    response.vary("X-Forwarded-Host");
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      response.status(405).type("text/plain").send("Method not allowed");
      return;
    }
    if (request.path === "/healthz") {
      response.setHeader("Cache-Control", "no-store");
      response.status(200).type("text/plain").send(request.method === "HEAD" ? undefined : "ok\n");
      return;
    }
    if (request.path === "/" || request.path === "/index.html") {
      response.setHeader("Cache-Control", "no-cache");
      response.status(200).type("html").send(request.method === "HEAD" ? undefined : renderedPage);
      return;
    }
    if (request.path === "/robots.txt") {
      response.setHeader("Cache-Control", "no-cache");
      response.status(200).type("text/plain").send(request.method === "HEAD" ? undefined : renderedRobots);
      return;
    }
    if (request.path === "/sitemap.xml") {
      response.setHeader("Cache-Control", "no-cache");
      response.status(200).type("application/xml").send(request.method === "HEAD" ? undefined : renderedSitemap);
      return;
    }
    staticAssets(request, response, (error) => {
      if (error) {
        next(error);
        return;
      }
      response.status(404).type("text/plain").send("Not found\n");
    });
  };
}

function parseOrigin(value: string, name: string, httpsOnly: boolean) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`${name} باید یک origin کامل مثل https://example.com باشد.`); }
  if (!/^https?:$/.test(parsed.protocol) || (httpsOnly && parsed.protocol !== "https:") || parsed.username || parsed.password || !["", "/"].includes(parsed.pathname) || parsed.search || parsed.hash) {
    throw new Error(`${name} باید origin ${httpsOnly ? "HTTPS" : "HTTP/HTTPS"} بدون مسیر یا اطلاعات ورود باشد.`);
  }
  if (httpsOnly && (parsed.hostname.endsWith(".example") || /replace|placeholder/i.test(parsed.hostname))) {
    throw new Error(`${name} هنوز مقدار نمونه دارد؛ میزبان واقعی انتخابی را وارد کنید.`);
  }
  return parsed;
}
