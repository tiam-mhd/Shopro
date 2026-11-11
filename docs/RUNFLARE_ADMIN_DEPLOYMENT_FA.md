# راه‌اندازی پنل تک‌مالک شاپرو روی Runflare

## مقادیر تأییدنشده

ساختار مخزن نشان می‌دهد API و رابط وب در یک image Docker و روی پورت `3000` اجرا می‌شوند و برنامه به PostgreSQL موجود نیاز دارد. نام Project، نام Docker Service، نام/آدرس DB داخلی، دامنهٔ واقعی، شمار proxyهای مورداعتماد و وضعیت backup زنده از این مخزن قابل مشاهده نیستند. در Runflare از Project و سرویس‌های فعلی استفاده کنید و مقادیر واقعی را از همان پنل بگیرید؛ این راهنما هیچ نام یا دامنه‌ای را production فرض نمی‌کند.

| موردی که مالک باید از Runflare تأیید کند | مقدار |
|---|---|
| Project موجود Shopro | `[نام Project فعلی را از Runflare وارد کنید]` |
| Docker Service موجود برنامه | `[نام Service فعلی را از Runflare وارد کنید]` |
| PostgreSQL موجود در همان Project | `[نام سرویس و host داخلی از Runflare]` |
| origin دقیق HTTPS برنامه | `[از تنظیم دامنهٔ متصل به سرویس بخوانید]` |
| دامنهٔ پنل مالک | `admin.shoproapp.ir`؛ اتصال به Docker Service و فعال‌بودن HTTPS را بررسی کنید. |
| `TRUST_PROXY_HOPS` | `[تعداد proxyهای مورداعتماد را از مسیر فعلی تأیید کنید]` |
| volume خصوصی receipt | `[mount path فعلی یا تصمیم مالک]` |
| backup/restore پایگاه‌داده و volume | `[روش فعال را پیش از deploy تأیید کنید]` |

## انتخاب سرویس و deploy

1. از ریشهٔ repository و `Dockerfile` موجود استفاده کنید. این image API NestJS، رابط React و لندینگ موجود را build می‌کند و سرویس برنامه روی `PORT=3000` می‌آید؛ سرویس Static برای API/session مناسب نیست.
2. از همان Runflare Project و Docker Service فعلی Shopro استفاده کنید. سرویس فرانت‌اند یا PostgreSQL موازی نسازید. اگر بررسی زنده نشان داد سرویس/DB موجود نیست، مالک باید قبل از تغییر توپولوژی آن را در همان Project ایجاد و اتصال داخلی را تأیید کند.
3. پیش از migration، از PostgreSQL و volume خصوصی رسیدها backup قابل‌بازیابی تهیه کنید. فقط وجود فایل backup کافی نیست؛ محل، زمان و روش restore را بررسی کنید. روش backup رمزگذاری‌شدهٔ مخزن در [راهنمای backup/restore](backup-restore.md) مستند است، ولی فعال‌بودن آن در Runflare تأیید نشده.
4. کد را در ریشهٔ پروژه با CLI موجود deploy کنید:

   ```sh
   runflare deploy
   ```

   در اولین اجرا Project و Service موجود را انتخاب کنید؛ در اجراهای بعدی همان انتخاب را نگه دارید. نوع سرویس باید Docker باشد. [راهنمای شروع Runflare](https://runflare.com/docs/get-started/) و [راهنمای deploy با CLI](https://runflare.com/docs/work-with-cli/cli-deploy/) را برای UI و promptهای فعلی سرویس ببینید.

5. فرمان `CMD` در Dockerfile ابتدا `npm run db:deploy` را روی `DATABASE_URL` اجرا می‌کند و پس از موفقیت API را بالا می‌آورد. اگر migration شکست بخورد، API نباید آمادهٔ دریافت ترافیک شود. از `migrate reset` یا حذف دستی داده استفاده نکنید.
6. پس از deploy از Runflare logs/events علت restart را بررسی کنید و health checkهای موجود را بزنید: `/api/v1/health/live` و `/api/v1/health/ready`. جزئیات داخلی DB یا Secret را در صفحهٔ عمومی health قرار ندهید.

## اتصال دامنهٔ پنل مالک

1. در همان Project، وارد تنظیم دامنه شوید و `admin.shoproapp.ir` را بدون `https://` یا `www` اضافه کنید. سپس در جزئیات دامنه، آن را به **Docker Service فعلی Shopro** وصل کنید؛ سرویس Static یا Docker جدا نسازید.
2. مقدارهای DNS را فقط از صفحهٔ Runflare بردارید. اگر DNS را نزد Cloudflare یا ابر آروان نگه می‌دارید، IP و رکورد TXT نمایش‌داده‌شده را هر دو ثبت کنید؛ برای هر ارائه‌دهندهٔ دیگر نیز فقط رکوردهای اعلام‌شده توسط Runflare را وارد کنید. مقدار A/CNAME یا TXT را حدس نزنید. اگر صفحهٔ دامنه تنظیم nameserver نشان می‌دهد، طبق همان صفحه پیش بروید و بعد «بررسی مجدد» را اجرا کنید.
3. برای همین دامنه در تنظیم SSL پروژه گواهی فعال کنید. تا وقتی `https://admin.shoproapp.ir` با گواهی معتبر باز نمی‌شود deploy را برای ورود ادمین نهایی نکنید.
4. در Environment همان Docker Service، `ADMIN_APP_ORIGIN=https://admin.shoproapp.ir` را اضافه کنید و دامنهٔ ادمین را به فهرست `WEB_ORIGIN` فعلی بیفزایید؛ مقدار فعلی محصول را حذف یا جایگزین نکنید. نمونه: `https://web.shoproapp.ir,https://admin.shoproapp.ir`، فقط اگر origin جاری محصول واقعاً همین است.
5. `COOKIE_SECURE=true` را حفظ کنید. cookie ادمین بدون `Domain` عمومی و فقط برای همین host صادر می‌شود؛ نشست ادمین با نشست فروشندگان به اشتراک گذاشته نمی‌شود. تغییر Environment سرویس را restart می‌کند؛ پس از آماده‌شدن DNS و TLS، از ریشهٔ repo `runflare deploy` را اجرا و logs/events و health checkها را بررسی کنید.

Runflare روند افزودن دامنه در تنظیم دامنهٔ Project و اتصال آن به سرویس موجود را در [راهنمای افزودن دامنه](https://runflare.com/docs/how-to-add-domain/) و [اتصال دامنه به سرویس](https://runflare.com/docs/add-domain-to-service/) شرح داده است. مسیر SSL را در [راهنمای SSL Runflare](https://runflare.com/docs/how-to-work-with-ssl/) ببینید. نام منوها ممکن است با نسخهٔ فعلی پنل تفاوت داشته باشد؛ رکوردهای DNS نهایی را از پنل خودتان بردارید.

## متغیرهای محیطی

مقدارهای زندهٔ سرویس را پیش از تغییر یادداشت کنید و تنظیم‌های مستقل آن را بازنویسی نکنید. `infra/runflare.env.example` فقط الگوی نام‌هاست؛ placeholderهایش را bulk-copy نکنید. متغیرها در تنظیمات Environment همان Docker Service تنظیم می‌شوند. Secretها را با گزینهٔ Secret نگه دارید. [راهنمای Environment Variables Runflare](https://runflare.com/docs/setup-environment-variable/) توضیح می‌دهد تنظیم env در سطح سرویس انجام می‌شود و تغییر آن restart سرویس را به‌دنبال دارد.

| کلید | مقدار از کجا می‌آید | Secret؟ | نکته |
|---|---|---:|---|
| `NODE_ENV` | `production` | خیر | Docker runtime production است. |
| `PORT` | `3000` | خیر | پورت image برنامه. |
| `WEB_ORIGIN` | origin دقیق فعلی محصول به‌علاوهٔ `https://admin.shoproapp.ir`، جداشده با کاما | خیر | origin موجود را از Environment زنده بخوانید و حفظ کنید. معادل قرارداد پیشنهادی `APP_ORIGIN` در این repo است؛ متغیر موازی نسازید. |
| `ADMIN_APP_ORIGIN` | `https://admin.shoproapp.ir` | خیر | برای فعال‌کردن host پنل تنظیم کنید؛ باید در `WEB_ORIGIN` هم باشد. درخواست `GET /` روی این host به `/system-admin` می‌رود و صفحهٔ محافظت‌شده کاربر ناشناس را به login هدایت می‌کند. |
| `SHOPRO_ADMIN_USERNAME` | دقیقاً `shopro_super_admin` | خیر | مقدار دیگری باعث توقف startup می‌شود. |
| `SHOPRO_ADMIN_INITIAL_PASSWORD` | رمز اولیه‌ای که مالک خودش در Runflare وارد می‌کند | **بله** | فقط bootstrap نخست. در repo، `.env.example`، command، log یا اسکرین‌شات قرار ندهید. پس از ورود موفق، حذف کنید. مقدار موجود در DB فقط Argon2id hash است. |
| `DATABASE_URL` | connection string خصوصی سرویس PostgreSQL موجود | **بله** | از host داخلی Runflare استفاده کنید. دسترسی remote را فعال نکنید. مقدار یا credential آن را در log چاپ نکنید. |
| `SESSION_SECRET` | Secret قوی و تصادفی موجود یا مقدار جدید ۳۲ بایت entropy | **بله** | حداقل ۳۲ کاراکتر لازم است؛ مقدار زندهٔ معتبر را بی‌دلیل rotate نکنید چون نشست‌ها و HMAC rate limit را تحت تأثیر قرار می‌دهد. |
| `COOKIE_SECURE` | `true` | خیر | دامنه باید HTTPS فعال داشته باشد. |
| `TRUST_PROXY_HOPS` | عدد دقیق زنجیرهٔ proxy موجود | خیر | مقدار نمونهٔ `1` را بدون تأیید مسیر Runflare production فرض نکنید. |
| `OTP_HASH_SECRET` | Secret تصادفی موجود و جدا از `SESSION_SECRET` | **بله** | ورود فروشندگان با OTP همچنان از این کلید استفاده می‌کند؛ ورود مدیر OTP ندارد. |
| `STOREFRONT_CARD_ENCRYPTION_KEY` | کلید تصادفی ۳۲ بایتی موجود | **بله** | باید با کلیدهای نشست و OTP متفاوت باشد؛ برای حفظ دادهٔ کارت ذخیره‌شده آن را rotate نکنید مگر طبق طرح مهاجرت کلید. |
| `PARSGREEN_API_KEY` | کلید واقعی حساب پیامکی موجود | **بله** | برای OTP کاربران عادی است. نبودنش در production startup را متوقف می‌کند. |
| `ATTACHMENT_STORAGE_DIR` | مسیر mount مطلق volume خصوصی و پایدار | خیر | همان volume receipt فعلی را حفظ کنید؛ مسیر باید برای process قابل‌نوشتن و بیرون از web root باشد. |
| `TELEGRAM_BOT_TOKEN` | توکن موجود، اگر اعلان تلگرام فعال است | **بله** | اختیاری؛ در Runflare نگه دارید، نه در repo. |
| `ADMIN_SESSION_IDLE_MINUTES` | پیش‌فرض `30` دقیقه | خیر | اختیاری؛ بازهٔ معتبر ۵ تا ۲۴۰. |
| `ADMIN_SESSION_MAX_HOURS` | پیش‌فرض `12` ساعت | خیر | اختیاری؛ بازهٔ معتبر ۱ تا ۱۶۸. |

`SESSION_TTL_DAYS` فقط نشست کاربر عادی است و timeout مدیر نیست. هر عضو `WEB_ORIGIN` و در صورت فعال‌کردن host پنل، مقدار `ADMIN_APP_ORIGIN` باید origin دقیق HTTPS و بدون path/query باشند. در فایل نمونه فقط دامنهٔ ادمین معلوم است؛ origin جاری محصول و سایر Secretها را از تنظیم زندهٔ سرویس بگیرید.

## Bootstrap حساب مالک

1. backup مرحلهٔ قبل را تأیید کنید. در تنظیمات Secret همان Docker Service موقتاً `SHOPRO_ADMIN_INITIAL_PASSWORD` را اضافه کنید و `SHOPRO_ADMIN_USERNAME=shopro_super_admin` را نگه دارید.
2. Deploy کنید. Docker ابتدا migration را اعمال می‌کند. هنگام startup، API با Argon2id حساب را در صورت نبودن مدیر ایجاد می‌کند. اگر دقیقاً یک مدیر قدیمی باشد، migration همان شناسه را به نام کاربری ثابت وصل می‌کند و Secret فقط نخستین رمز hashشده را برایش ثبت می‌کند. اگر چند مدیر قدیمی باشد، startup متوقف می‌شود؛ این حالت را با انتخاب تصادفی مدیر حل نکنید.
3. به `https://admin.shoproapp.ir` بروید؛ ریشهٔ دامنه به پنل و در صورت نداشتن نشست معتبر به `/system-admin/login` هدایت می‌شود. نام کاربری را دستی وارد کنید؛ فیلد از پیش پر نشده است. حساب مالک `shopro_super_admin` است. پس از ورود، تغییر رمز و فعال‌بودن نشست را از بخش «امنیت حساب» بررسی کنید.
4. `SHOPRO_ADMIN_INITIAL_PASSWORD` را از Service Environment حذف و سرویس را restart کنید. کد در startup بعدی رمز hashشدهٔ موجود را دست نمی‌زند؛ secret اولیه برای deployهای بعدی لازم نیست.

برای آماده‌سازی کاتالوگ پلن اشتراک در DB موجود، در صورت نیاز `SHOPRO_SUBSCRIPTION_SEED_CONFIRM=SEED_SUBSCRIPTION_CATALOG` را موقتاً تنظیم و در console سرویس اجرا کنید:

```sh
npm run db:setup:production
```

این فرمان migration را دوباره به‌صورت idempotent بررسی و کاتالوگ قیمت را seed می‌کند؛ مدیر جدید نمی‌سازد و رمز مدیر موجود را عوض نمی‌کند. بعد از موفقیت متغیر تأیید را حذف و سرویس را restart کنید. اگر کاتالوگ قبلاً آماده است، seed لازم نیست.

## بازیابی رمز فراموش‌شده

این مسیر فقط از دسترسی console سرویس استفاده می‌کند؛ endpoint عمومی ندارد.

1. در Environment سرویس، `SHOPRO_ADMIN_RECOVERY_PASSWORD` را به‌صورت Secret موقت و `SHOPRO_ADMIN_RECOVERY_CONFIRM=RESET_SINGLE_OWNER_PASSWORD` را تنظیم کنید.
2. پس از restart سرویس، در console اجرا کنید:

   ```sh
   npm run admin:recover
   ```

3. command تنها حساب فعال `shopro_super_admin` را می‌پذیرد، رمز جدید را hash می‌کند، همهٔ نشست‌ها را revoke و رخداد audit ثبت می‌کند. command مقدار رمز را چاپ نمی‌کند.
4. هر دو متغیر بازیابی را از سرویس حذف و سرویس را restart کنید؛ سپس با رمز تازه وارد شوید.

## Rollback و بررسی پس از deploy

- Migration افزایشی است و rollback خودکار schema ندارد. اگر نسخهٔ جدید به مشکل خورد، از release/image قبلی برای Docker Service استفاده کنید (یا از commit قبلی در ریشهٔ repo با همان `runflare deploy` deploy کنید) و migration را به عقب برنگردانید. ستون‌ها/جدول‌های افزوده را حذف نکنید؛ rollback دیتابیس ممکن است audit و دادهٔ جدید را از بین ببرد.
- نشست‌های admin قدیمی هنگام migration باطل شده‌اند؛ پس از بازگشت نسخه نیز ورود مجدد لازم است. برای بازیابی داده، backup پایگاه‌داده و snapshot volume را فقط در روش نگه‌داری‌شدهٔ خودتان restore کنید و پیش از آن با restore آزمایشی سازگاری را بررسی کنید.
- در Runflare logs/events موفقیت `db:deploy`، startup API، health ready و نبود restart loop را بررسی کنید. رمز و connection string را در command history یا خروجی پشتیبانی نگذارید.
- مواردی که مالک پیش از اجرای production باید تکمیل/تأیید کند: Project و Docker Service فعلی، PostgreSQL داخلی، origin HTTPS، تعداد trusted proxy، volume رسید و backup قابل‌بازیابی. این مقادیر در این repository قابل راستی‌آزمایی نبودند.

## مستندات Runflare

- [شروع Runflare و Project/Service](https://runflare.com/docs/get-started/)
- [Deploy از CLI](https://runflare.com/docs/work-with-cli/cli-deploy/)
- [Environment Variables و Secretها](https://runflare.com/docs/setup-environment-variable/)
- [PostgreSQL در Runflare](https://runflare.com/docs/postgres/)
