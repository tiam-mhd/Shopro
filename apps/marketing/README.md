# Shopro marketing site

This is a static-first Persian landing page with its own build output and local preview server. Production assets are included in the existing Shopro Docker image and served by the current API listener only when the request Host matches `MARKETING_PUBLIC_URL`; the product Host and its routes keep using the existing web application.

## Local commands

Run from the repository root:

```powershell
npm run dev --prefix apps/marketing
npm run build --prefix apps/marketing
npm run start --prefix apps/marketing
```

The development server watches `src/` and listens on `0.0.0.0:5174` by default. For standalone preview, `npm run start --prefix apps/marketing` serves `dist/` on `0.0.0.0:8080`; `PORT`, `PUBLIC_URL`, and `PRODUCT_URL` configure that local server. In the current Runflare item, the API still owns `PORT=3000`; set `MARKETING_PUBLIC_URL` to the selected landing origin and `PRODUCT_URL` (default `https://shoproapp.ir`) for product-entry links. The marketing host also answers `/healthz`.

This package intentionally has no npm dependencies. The official logo is copied unchanged from `apps/web/public/icons/Logo.webp`; the local Vazirmatn subset files and OFL license are copied from the font already used by the web app. Product panels are labeled reconstructions made from current interface concepts, not live screenshots. Their sample names and numbers are fictional. Do not use the marketing-only Dockerfile to create another Runflare item; production uses the repository root `Dockerfile` and existing Shopro item.

See [the separate Runflare deployment guide](../../docs/runflare-marketing-deployment.md).
