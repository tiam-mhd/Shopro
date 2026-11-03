# شاپرو

شاپرو یک PWA فارسی و راست‌چین برای فروش، خرید، موجودی، طرف‌حساب‌ها، هزینه‌ها و عملیات مالی روزمره است. معماری پروژه بر اساس فایل‌های پیاده‌سازی و مشخصات فنی داخل `0-DOCS` ساخته شده است.

## نیازمندی‌ها

- Node.js 22.15 یا جدیدتر
- Docker Desktop برای PostgreSQL توسعه، یا یک PostgreSQL 17 قابل دسترس
- توکن API پارس‌گرین برای ارسال واقعی کد ورود

## اجرای محلی

1. فایل `.env.example` را به `.env` کپی و کلیدهای تصادفی را مقداردهی کنید. `SESSION_SECRET` و `OTP_HASH_SECRET` باید جداگانه و حداقل ۳۲ نویسهٔ تصادفی باشند. `TRUST_PROXY_HOPS` در توسعه صفر است؛ پشت reverse proxy فقط تعداد hopهای مورداعتماد را وارد کنید.
2. PostgreSQL توسعه را با `docker compose -f infra/docker-compose.yml up -d` اجرا کنید.
3. وابستگی‌ها را با `npm ci` نصب کنید.
4. Prisma Client و طرح پایگاه داده را آماده کنید:

   ```powershell
   npm run db:generate
   npm run db:deploy
   ```

5. برای دادهٔ نمونهٔ صرفاً توسعه، با `NODE_ENV=development` اجرا کنید:

   ```powershell
   npm run db:seed
   ```

   شمارهٔ نمونه به‌طور پیش‌فرض `09120000000` است و با `SHOPRO_SEED_PHONE` قابل‌تغییر است. این seed در محیط غیرتوسعه اجرا نمی‌شود.

6. سرویس‌ها را با `npm run dev` اجرا کنید. رابط در `http://localhost:5173` و API در `http://localhost:3000/api/v1` در دسترس است.

ارسال OTP تا وقتی `PARSGREEN_API_KEY` در `.env` قرار نگیرد عمداً غیرفعال است. OTP در API فقط هش‌شده نگه‌داری می‌شود و کلید پارس‌گرین هیچ‌وقت به مرورگر نمی‌رود.

## استقرار در Runflare

برای استقرار با کمترین تعداد آیتم، یک سرویس Docker رابط PWA و API را با هم اجرا می‌کند و یک سرویس PostgreSQL داده‌ها را نگه می‌دارد. Dockerfile چندمرحله‌ای در ریشهٔ مخزن قرار دارد. راهنمای ساخت دو سرویس، تنظیم محیط، migration و ساخت مدیر سامانه در [راهنمای Runflare](docs/runflare-deployment.md) است؛ الگوی env قابل کپی نیز در `infra/runflare.env.example` قرار دارد.

ابزار رمزگذاری‌شدهٔ backup/restore برای runner جداگانه و محدودیت‌های فعلی آن در [راهنمای پشتیبان‌گیری](docs/backup-restore.md) آمده است. این runner و فضای پایدار در Runflare هنوز پیکربندی نشده‌اند.

## مدیر سامانه

مدیر سامانه از جدول و نشست مجزای `system_admins` ساخته می‌شود و به‌صورت خودکار کاربر یا عضو یک کسب‌وکار نمی‌شود. پس از اجرای migration:

```powershell
npm run admin:create -- --phone 09123456789 --name "نام مدیر"
```

یا `ADMIN_BOOTSTRAP_PHONE` و `ADMIN_BOOTSTRAP_NAME` را در محیط اجرای فرمان بگذارید. ورود مدیر سامانه از مسیر جداگانهٔ `/api/v1/system-admin/auth/otp/request` و `/api/v1/system-admin/auth/otp/verify` انجام می‌شود.

پس از ورود، API فقط‌خواندنی مرور سامانه، فهرست صفحه‌بندی‌شدهٔ کسب‌وکارها و سابقهٔ audit در [راهنمای مدیر سامانه](docs/system-admin.md) در دسترس است. نشست و CSRF مدیر از نشست کاربران عادی جدا نگه‌داری می‌شود.

نتیجهٔ ممیزی وابستگی‌ها و فهرست مجوزها در [گزارش dependency audit](docs/dependency-audit.md) ثبت شده است.

## اشتراک شعب

جزئیات مدل اشتراک، migration، کاتالوگ، API مدیر سامانه، rollout و راهنمای استقرار در [راهنمای اشتراک شعب](0-DOCS/shopro-subscription-rollout-fa.md) آمده است. درگاه پرداخت واقعی هنوز انتخاب و متصل نشده؛ بنابراین خرید واقعی در production عمداً غیرفعال است تا adapter و اعتبارسنجی سمت سرور درگاه اضافه شود.

## مدل دسترسی

- هر کاربر می‌تواند مالک چند کسب‌وکار باشد.
- هر کسب‌وکار چند شعبه دارد؛ عضو کسب‌وکار فقط به شعبی دسترسی دارد که در `member_branches` برای او ثبت شده‌اند.
- هر درخواست در فضای کاری باید `x-business-id` و `x-branch-id` داشته باشد. سرور عضویت، کسب‌وکار و شعبه را از پایگاه داده بررسی می‌کند؛ شناسهٔ فرستاده‌شده به تنهایی مجوز ایجاد نمی‌کند.
- اسناد، طرف‌حساب‌ها، کالاها، حساب‌ها و دفتر مالی در محدودهٔ همان کسب‌وکار نگه‌داری می‌شوند. خطوط دفتر و موجودی علاوه بر کسب‌وکار به شعبه محدود هستند.

## مسیرهای اصلی

- `POST /auth/otp/request`, `POST /auth/otp/verify`, `GET /auth/session`
- `GET|POST /businesses`, `GET|PATCH /businesses/current`, مدیریت شعبه و عضو
- `/sales`, `/sales/:id`, `/sales/:id/returns`, `/sales/:id/void`, `/purchases`, `/expenses`, `/parties`, `/products`
- `/inventory/levels`, `/inventory/movements`, `/inventory/counts`
- `/finance/accounts`, `/finance/transactions`, `/finance/cash-closes`, `/cash-transactions/*`
- `/finance/closed-periods` و مسیر بازگشایی ممیزی‌شده
- `/reports/dashboard`, `/reports/profit-loss`, `/reports/cash-flow`, `/reports/inventory`, `/reports/trial-balance`
- `/health/live`, `/health/ready`

## ارز و تاریخ

تمام مبالغ در API با رشتهٔ ده‌دهی ریال هستند؛ ذخیره‌سازی پایگاه داده `BIGINT` است تا خطای ممیز شناور ایجاد نشود. تبدیل ریال/تومان فقط در رابط انجام می‌شود. تاریخ رابط شمسی است و تاریخ سند در API به‌شکل ISO میلادی `YYYY-MM-DD` منتقل می‌شود.

## نکتهٔ نسخهٔ تقویم

در npm برای `date-fns-jalali` نسخهٔ stable بدون پسوند پیش‌انتشار منتشر نشده است؛ پروژه نسخهٔ دقیق `4.4.0-0` را pin می‌کند تا انتخاب تقویم خواسته‌شدهٔ مشخصات حفظ شود. سایر نسخه‌ها با lockfile قفل می‌شوند.

## مرز فعلی اتصال پیامک

نمونهٔ رسمی ناشر `PARSGREEN.CORE` متد `SendOtp(mobile, code)` را با API key نشان می‌دهد. تطبیق قطعی قرارداد HTTP روی حساب واقعی پارس‌گرین بدون توکن و پاسخ سرویس ممکن نیست؛ فرستنده در `apps/api/src/auth/parsgreen.service.ts` محصور شده تا در صورت تفاوت جزئی مسیر یا نام فیلدها، تنها همین adapter تنظیم شود. جزئیات بررسی در [تصمیم‌های معماری](docs/architecture.md) آمده است.
