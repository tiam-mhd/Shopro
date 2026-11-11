# سند فنی و دامنهٔ تسک — پنل مدیریت تک‌مالک شاپرو

## ۱. خلاصه

هدف، افزودن پنل مدیریت عملیاتی Shopro برای استفادهٔ مالک است: رابط فارسی و راست‌به‌چپ، طراحی ساده و Bootstrap‌محور، همراه با ابزارهای واقعی برای مدیریت کسب‌وکارها، شعبه‌ها، اشتراک‌ها، سفارش‌ها، پرداخت‌ها، رسیدها، گزارش‌ها و سلامت سرویس.

این پنل **تک‌مالک** است. حساب اولیه:

- نام کاربری ثابت: `shopro_super_admin`
- رمز اولیه: از Secret پنل Runflare توسط مالک وارد می‌شود؛ در این سند، prompt، سورس، فایل نمونهٔ env یا repository درج نمی‌شود.
- ایجاد ادمین دوم، ثبت‌نام عمومی و مسیر reset-password عمومی وجود ندارد.

پنل فقط زمانی امن است که کنترل دسترسی در backend اجرا شود. مسیر مخفی، بررسی username در React، مقدار ثابت در JavaScript یا نگهداری token در `localStorage` دسترسی اختصاصی ایجاد نمی‌کند.

## ۲. وضعیت اطلاعات و فرض‌ها

نسخهٔ stack، مدل‌های واقعی دیتابیس، APIهای فعلی، دامنهٔ production و نوع دقیق سرویس Runflare باید از خود ریپازیتوری و پنل Runflare در زمان اجرا استخراج شوند. این سند عمداً فریم‌ورک یا نام جدول خاصی را قطعی فرض نمی‌کند.

پیش از کدنویسی این موارد ثبت شوند:

| مورد | باید مشخص شود |
|---|---|
| Frontend/runtime | Framework، نسخهٔ runtime و دستور build/start |
| Backend | API/server موجود، routeها و احراز هویت فعلی |
| Data | ORM، جداول کاربران/فروشگاه/شعبه/اشتراک/سفارش/پرداخت و migrationها |
| Runflare | Project موجود، serviceهای frontend/backend، DBها، دامنه و envها |
| UI | router، component library، font و الگوی فعلی RTL |
| عملیات | وضعیت واقعی درگاه، کارت‌به‌کارت، رسید، اعلان و jobهای پس‌زمینه |

اگر repository private یا index جست‌وجویش در دسترس نباشد، Codex باید در workspace خودش فایل‌ها را بخواند و نام‌های واقعی را قبل از تغییر استخراج کند.

## ۳. محدوده و محدودیت‌ها

### در محدوده

- ورود امن یک مالک، تغییر رمز، session management و رخدادهای امنیتی.
- نمای مدیریتی کلی، فهرست‌ها، جزئیات، جست‌وجو، فیلتر، مرتب‌سازی، صفحه‌بندی، تغییر وضعیت، یادداشت و خروجی کنترل‌شده.
- گزارش عملیات و سنجه‌های مبتنی بر دادهٔ معتبر Shopro.
- راهنمای دقیق استقرار روی Runflare و تنظیم Secretها.

### خارج از محدوده، مگر اینکه در کد فعلی وجود داشته و بخشی از جریان باشد

- ساخت محصول موازی یا بازنویسی backend/storefront.
- ساخت multi-tenant admin، چند نقش ادمین، ثبت‌نام ادمین یا دعوت کاربر جدید.
- تغییر در UI صفحات مشتری، onboarding عمومی، منطق فروش/حسابداری یا پرداخت موجود.
- ذخیرهٔ دستی/محلی به‌جای دیتابیس سرور برای داده‌های مدیریتی.
- نمایش اطلاعات کامل کارت بانکی، CVV، رمز، token پرداخت یا secrets.
- افزودن سرویس SaaS بیرونی، ایمیل، پیامک، analytics یا SSO جدید بدون وجود پیکربندی و رضایت مالک.

## ۴. معماری Runflare

Runflare برای هر وب‌اپلیکیشن یک Project دارد و در یک Project می‌تواند سرویس frontend، backend و database تعریف شود. انتخاب دقیق باید با قابلیت واقعی repository تطبیق داده شود.

| وضعیت فعلی Shopro | تصمیم معماری |
|---|---|
| Backend و DB امن موجود | routeهای admin را روی همان backend اضافه و DB موجود را reuse کن. |
| Frontend استاتیک، بدون backend | یک backend قابل‌اجرا در Runflare (معمولاً NodeJS، اگر با stack سازگار باشد) و DB لازم را در همان Project اضافه کن. صرفاً Static service برای احراز هویت امن کافی نیست. |
| API جدا از frontend | API را با same-origin/BFF، یا با CORS محدود به origin دقیق Shopro، secure-cookie و CSRF مناسب یکپارچه کن. CORS wildcard ممنوع است. |
| DB موجود | از همان DB استفاده کن و migration additive بساز؛ DB موازی بدون نیاز اضافه نکن. |
| DB موجود نیست | PostgreSQL در همان Project گزینهٔ پیش‌فرض است؛ connection داخلی Runflare را در Secret قرار بده و دسترسی Remote را خاموش نگه دار مگر ضرورت مستند باشد. |

سرویس Static می‌تواند فایل‌های UI را ارائه کند، ولی password verify، session، authorization، audit persistence و دسترسی امن به DB باید server-side انجام شوند. اگر Runflare Service فعلی فقط Static باشد، Codex باید مشخص کند backend کجا اجرا خواهد شد و قبل از تحویل یک راهکار واقعی و قابل deploy بسازد؛ UI نمایشی قابل قبول نیست.

## ۵. حساب و چرخهٔ احراز هویت

### ایجاد اولیه

1. مالک در تنظیمات Runflare برای سرویس backend متغیرهای bootstrap را اضافه می‌کند.
2. در آغاز برنامه، اگر جدول ادمین حسابی ندارد و bootstrap فعال است، یک حساب با username `shopro_super_admin` ایجاد شود.
3. رمز از `SHOPRO_ADMIN_INITIAL_PASSWORD` خوانده و با Argon2id و salt یکتا hash شود؛ فقط hash در DB ذخیره شود.
4. bootstrap idempotent باشد: وجود یک حساب مانع هرگونه reset یا ساخت حساب دوم شود.
5. پس از ساخت موفق، bootstrap secret از تنظیمات Runflare حذف شود یا bootstrap غیرفعال گردد. حذف secret نباید ورود را از کار بیندازد.
6. رمز داخل migration، seed versioned، source, container image, GitHub Actions logs, console یا خود گزارش deploy درج نشود.

### ورود و نشست

- username ثابت یا بر اساس env قراردادی مقایسه شود؛ پیام خطا برای username ناموجود و password اشتباه یکسان باشد.
- password با hash امن مقایسه شود.
- session تصادفی با حداقل ۱۲۸ بیت entropy تولید شود؛ session سمت سرور نگهداری شود. اگر framework session store مناسبی دارد، همان را reuse کن.
- cookie پیشنهادی: `__Host-shopro_admin_session` با `Secure`, `HttpOnly`, `SameSite=Strict` یا مقدار سازگار با flow که در threat model توضیح داده شود، `Path=/` و بدون `Domain`.
- session ID بعد از login rotate شود. در صورت نگهداری token در DB، verifier/hash آن ذخیره شود، نه token خام.
- timeout سمت سرور enforce شود: پیش‌فرض ۳۰ دقیقه بی‌فعالیتی و ۱۲ ساعت عمر حداکثر؛ مقدار قابل تنظیم باشد.
- Logout در server session را revoke کند و cookie را پاک کند؛ پاک‌کردن cookie به‌تنهایی کافی نیست.
- تغییر رمز نیازمند رمز فعلی، رمز جدید، تأیید رمز و محدودیت طول/strength متناسب است. پس از تغییر، نشست‌های قبلی باطل شوند.
- reset عمومی با email/SMS طراحی نشود. بازیابی مالک در صورت فراموشی رمز از مسیر یک‌بارهٔ server-side/CLI و مستند، با audit و حذف مسیر bootstrap انجام شود.

### محافظت در برابر حمله

- login rate limit براساس ترکیب IP و username نرمال‌شده؛ محدودیت اولیه ۵ تلاش ناموفق در ۱۵ دقیقه با backoff افزایشی، بدون قفل دائمی قابل سوءاستفاده برای DoS.
- audit ورود موفق/ناموفق با IP و User-Agent در صورت نیاز عملیاتی، به‌شکل کمینه و با retention مشخص؛ هیچ password، cookie، token یا body حساس log نشود.
- محافظت CSRF برای تمام mutationها؛ CORS همان-origin یا allowlist دقیق.
- Content Security Policy و security headers مطابق framework.
- re-auth با password فعلی برای تغییر رمز و تغییرات پرخطر.
- MFA/TOTP فقط اگر کامل و قابل‌بازیابی امن ساخته شود؛ در غیر این صورت به‌عنوان توسعهٔ آینده ثبت شود و UI خام/غیرفعال برای آن نساز.

## ۶. نقش‌ها و سطح دسترسی

فقط یک principal مدیریتی وجود دارد: `super_admin` با شناسهٔ داخلی ثابت و username `shopro_super_admin`.

- هیچ endpoint عمومی برای ساخت حساب ادمین نباشد.
- کاربرهای عادی Shopro فقط از پنل و API خودشان استفاده کنند.
- server middleware برای `/admin/*` و تمام `/api/admin/*`, server actions, exports, downloads و mutationها وجود داشته باشد.
- دسترسی هر request در backend بررسی شود؛ hidden button یا route guard سمت client تنها مانع نباشد.
- direct URL، درخواست بدون cookie، session منقضی و CSRF نامعتبر باید بدون افشای data رد شود.
- endpoint سلامت عمومی فقط status کلی و غیرحساس بدهد؛ stack trace، DB hostname یا نسخهٔ آسیب‌پذیر نمایش داده نشود.

## ۷. مدل دادهٔ پیشنهادی

مدل واقعی پروژه اولویت دارد؛ موارد زیر الگوی منطقی‌اند و نباید duplicate table بی‌دلیل ایجاد کنند.

| موجودیت | فیلدهای منطقی | نکته |
|---|---|---|
| `AdminAccount` | id, username, password_hash, active, password_changed_at, created_at, updated_at, credential_version | تنها یک ردیف مجاز؛ unique username |
| `AdminSession` | id, admin_id, token_hash/verifier, created_at, last_seen_at, expires_at, revoked_at, user_agent, ip_hash | session server-side؛ index روی admin/expiry |
| `AdminAuditEvent` | id, actor_admin_id, event_type, entity_type, entity_id, old_summary, new_summary, reason, request_id, created_at | append-only؛ redacted; update/delete ممنوع |
| `AdminNote` | id, entity_type, entity_id, note, created_by_admin_id, created_at | فقط یادداشت داخلی |
| Existing Shopro models | tenant/user, branch, subscription, order, payment, receipt, product, notification… | reuse و رابطهٔ دقیق با source of truth |

مقادیر شخصی و مالی در audit log را حداقل نگه دار. برای old/new summary از فیلدهای غیرحساس استفاده کن. Session table باید clean-up دوره‌ای برای دادهٔ منقضی‌شده داشته باشد؛ حذف audit log تابع retention و سیاست backup باشد.

## ۸. صفحات و عملیات

### نمای کلی

- فیلتر بازهٔ جلالی، مقایسه با بازهٔ قبل، خروجی CSV محدود به همین فیلتر.
- کارت‌های کسب‌وکار، شعبه، اشتراک، درآمد، تمدید، سفارش، پرداخت ناموفق، رسید منتظر بررسی و شاخص‌های سلامت.
- نمودار روند با انتخاب سنجه و بازه؛ tooltip با تاریخ/واحد/منبع.
- بخش «نیاز به رسیدگی» از دادهٔ واقعی: اشتراک‌های منقضی، رسیدهای در انتظار، پرداخت‌های ناموفق، jobهای شکست‌خورده.

### کسب‌وکار/کاربر

جدول: نام/شناسه، وضعیت، تاریخ عضویت، شعب، پلن، آخرین پرداخت، آخرین فعالیت. عملیات: جزئیات، یادداشت، فعال/تعلیق با دلیل، بررسی audit. حذف فیزیکی پیش‌فرض نباشد.

### شعبه

جدول شعب وابسته به کسب‌وکار، شهر/عنوان موجود در مدل، وضعیت، اشتراک جاری و تاریخ پایان. هر تغییر مجوز/وضعیت دلیل و audit می‌خواهد.

### پلن و اشتراک

پلن‌ها، دوره، قیمت جاری، قیمت snapshot خرید، تعداد شعبه، وضعیت و تاریخ تمدید. دوره‌های ۱، ۳، ۶ و ۱۲ ماه و قیمت‌گذاری شعبه‌ای را با مدل فعلی بررسی کن؛ مقدار قیمت یا تخفیف را از سند hardcode نکن. تاریخچهٔ قیمت نگه داشته شود.

### سفارش، پرداخت، رسید

جدول با شناسه، فروشگاه/شعبه، تاریخ، جمع مبلغ، وضعیت سفارش، وضعیت پرداخت و وضعیت رسید. عملیات مجاز براساس workflow موجود؛ هر override با تأیید، علت و audit. فایل receipt و دادهٔ بانکی در storage خصوصی بماند؛ لینک دانلود نیازمند session و authorization است.

### گزارش و خروجی

گزارش درآمد، اشتراک، رشد فروشگاه، سفارش و پرداخت بر اساس دادهٔ حقیقی. معیارها با واحد ریال/تومان، بازهٔ جلالی و امکان مقایسه. CSV export فیلدهای حساس را حذف کند و با فیلترهای فعال consistent باشد.

### رخدادهای ادمین و سلامت

ورودها و تغییرهای حساس با فیلتر زمان، نوع رخداد، entity و نتیجه. سلامت API/DB/migration/job/backup از probe امن داخلی گرفته شود؛ صفحه فقط وضعیت خلاصه و زمان آخرین بررسی را نشان دهد.

### تنظیمات

تغییر password، نشست‌ها، logout همه نشست‌ها، theme-density/زبان در صورت موجود بودن، تنظیمات عملیاتی مجاز و feature flags. هیچ setting مربوط به secret یا DB connection را در UI قابل‌خواندن نکن.

## ۹. KPI و قرارداد محاسبه

تمام KPIها باید نام، تعریف، فرمول، جدول/فیلد منبع، محدودهٔ زمانی، وضعیت کامل‌بودن داده و واحد داشته باشند. مثال‌های اولیه:

| KPI | تعریف پیشنهادی |
|---|---|
| کسب‌وکار فعال | تعداد tenantهای دارای وضعیت active در انتهای بازه |
| شعبهٔ پرداخت‌کننده | شعبه با اشتراک معتبر و پرداخت ثبت‌شده، طبق مدل موجود |
| درآمد وصول‌شده | مجموع تراکنش موفق در بازه منهای refund ثبت‌شده؛ مبنای ریال یا تومان روشن باشد |
| MRR | درآمد تکرارشوندهٔ اشتراک‌های فعال به ماه نرمال‌شده، فقط اگر دادهٔ دوره‌ای کامل باشد |
| نرخ تمدید | اشتراک‌های تمدیدشده از بین اشتراک‌های واجد تمدید در همان cohort |
| churn | اشتراک‌های لغوشده/غیرفعال‌شده از بین اشتراک‌های فعال ابتدای بازه؛ تعریف رویداد لغو صریح باشد |
| سفارش تکمیل‌شده | سفارش در وضعیت نهایی موفق طبق status mapping واقعی پروژه |
| رسید منتظر بررسی | تعداد receiptهایی که status واقعی آن‌ها pending است |

نرخ صفر را از «فاقد داده» جدا کن. اعداد صفحهٔ admin از fixture/demo یا شمارندهٔ client-side نیایند. مبلغ‌ها به integer minor unit (یا قرارداد موجود) ذخیره/محاسبه و فقط هنگام نمایش format شوند.

## ۱۰. جست‌وجو، فیلتر و صفحه‌بندی

- هر فهرست از API دارای query contract یکسان باشد: `q`, فیلترهای مشخص، `sort`, `direction`, `page`, `pageSize`.
- `pageSize` پیش‌فرض ۲۵، انتخاب‌های ۲۵/۵۰/۱۰۰ و سقف ۱۰۰.
- SQL/ORM query parameterized؛ هیچ string interpolation از query کاربر.
- sorting فقط روی فهرست allowlist ستون‌های معتبر.
- search debounce، loading state و cancellation برای درخواست قبلی؛ بدون ارسال هر حرف به endpoint مستقل.
- معیار total count با pagination هم‌خوان باشد؛ ترتیب پایدار با secondary key.
- تاریخ UI جلالی و پارامتر API ISO-8601/UTC.
- فیلترها در URL قابل share داخلی باشند اما token/PII در URL قرار نگیرد.

## ۱۱. قرارداد endpointهای پیشنهادی

نام و الگوی موجود repository را اولویت بده؛ این فهرست قرارداد مفهومی است:

| روش | مسیر مفهومی | کاربرد |
|---|---|---|
| `POST` | `/api/admin/auth/login` | ورود؛ پاسخ عمومی و امن |
| `GET` | `/api/admin/auth/me` | هویت و وضعیت نشست جاری |
| `POST` | `/api/admin/auth/logout` | revoke نشست |
| `POST` | `/api/admin/auth/change-password` | تغییر رمز و revoke نشست‌ها |
| `POST` | `/api/admin/auth/revoke-sessions` | خروج از همه نشست‌ها |
| `GET` | `/api/admin/dashboard` | KPIهای بازه‌ای |
| `GET` | `/api/admin/businesses` | جست‌وجو/فیلتر/صفحه‌بندی |
| `GET/PATCH` | `/api/admin/businesses/:id` | جزئیات و تغییر وضعیت مجاز |
| `GET` | `/api/admin/branches` | فهرست و فیلتر شعب |
| `GET` | `/api/admin/subscriptions` | اشتراک‌ها و تمدیدها |
| `GET/PATCH` | `/api/admin/orders/:id` | سفارش و transition مجاز |
| `GET/PATCH` | `/api/admin/receipts/:id` | رسید و وضعیت بررسی مجاز |
| `GET` | `/api/admin/audit-events` | لاگ مدیریتی |
| `GET` | `/api/admin/exports/:dataset` | خروجی محدود و authorized |

تمام mutationها CSRF-protected، input-validated، idempotent در صورت لزوم و audit‌شده باشند. پاسخ خطا اطلاعات داخلی یا stack trace ندهد.

## ۱۲. UI/UX و نمایش داده

- RTL واقعی در grid، drawer، modal، date picker و جهت آیکون؛ فقط `text-align:right` کافی نیست.
- ظاهر Bootstrap‌محور: sidebar، topbar، breadcrumb، cards، tabs، table toolbar، filters، badges، modal تأیید، toast و pagination.
- ترکیب سفید/خاکستری و سبز شاپرو؛ نارنجی برای هشدار محدود؛ قرمز فقط خطا/عملیات پرخطر.
- فونت فارسی خوانا و self-hosted؛ Vazirmatn در صورت نبود فونت فعلی.
- فیلدهای فرم label، خطای قابل‌فهم، focus state و keyboard accessibility داشته باشند.
- صفحه‌بندی و فیلتر در موبایل به drawer یا toolbar جمع‌شونده منتقل شود؛ جدول‌ها horizontal overflow کنترل‌شده یا row-card موبایل داشته باشند.
- عددهای بزرگ در کارت KPI نباید بریده شوند؛ responsive type و tooltip/format کامل لحاظ شود.
- وضعیت‌ها هم متن داشته باشند، نه رنگ تنها.
- پول: یک واحد مرجع داخلی؛ تبدیل ریال↔تومان در formatter مشترک و قابل‌تست طبق قرارداد پروژه.

## ۱۳. لاگ، حریم خصوصی و backup

- app log فقط request ID، route، status، latency و خطای redacted.
- audit log فقط metadata موردنیاز؛ رمز، OTP، cookie، session token، secret، full bank card یا محتوای receipt در log ممنوع.
- admin log با دسترسی owner-only و retention مستند.
- database backup و فایل‌های receipt backup جداگانه بررسی شوند؛ مسیر restore روی Runflare در runbook نوشته شود.
- اگر DB یا storage حساس در Runflare ایجاد شد، دسترسی Remote/عمومی را خاموش و credentialها را فقط Secret قرار بده.

## ۱۴. متغیرهای Runflare

قبل از ایجاد هر متغیر، env فعلی سرویس و framework را بخوان. از duplicate نام‌های مشابه مثل `AUTH_SECRET`, `SESSION_SECRET`, `JWT_SECRET` بدون نیاز اجتناب کن. متغیرهای پیشنهادی:

| متغیر | مقدار در Runflare | حالت |
|---|---|---|
| `SHOPRO_ADMIN_USERNAME` | `shopro_super_admin` | EnvVar |
| `SHOPRO_ADMIN_INITIAL_PASSWORD` | مقدار bootstrap که مالک مستقیم در Runflare وارد می‌کند | Secret |
| `SESSION_SECRET` | مقدار تصادفی حداقل ۳۲ بایت entropy | Secret |
| `DATABASE_URL` | connection string داخلی سرویس PostgreSQL همان Project، اگر DB وجود دارد | Secret |
| `APP_ORIGIN` | origin دقیق production Shopro، شامل `https://` | EnvVar |
| `NODE_ENV` | `production` | EnvVar، اگر framework مصرف می‌کند |

تنظیم‌های `cookie secure`, session expiry و rate limit تا حد ممکن در کد با default امن باشند. اگر env لازم شد، نام و مقدار غیرحساس را در runbook بیاور. مقدار password و secret را به هیچ فایل متنی، خروجی، prompt به GitHub، `.env.example`، issue یا commit منتقل نکن. `.env.example` فقط placeholder دارد. پس از bootstrap، Secret اولیهٔ password را حذف/غیرفعال کن؛ هیچ deploy نباید account/hash موجود را با آن بازنشانی کند.

Runflare محیطی را به‌ازای هر سرویس تنظیم می‌کند و برای Secret حالت جدا دارد؛ تغییر env ممکن است سرویس را restart کند. آدرس DB داخلی Runflare را از صفحهٔ DB بگیر؛ طبق راهنمای Runflare برای اتصال داخلی معمولاً host سرویس DB استفاده می‌شود و Remote DB access جداگانه قابل‌فعال/غیرفعال است.

## ۱۵. استقرار و بازگشت

1. Backup DB و فایل‌های مربوط به receipt را پیش از migration بگیر.
2. اول deploy روی service آزمایشی یا staging، اگر در project وجود دارد.
3. env secrets را فقط در Runflare backend service وارد کن؛ env frontend secret نیست.
4. migration را یک‌بار و با lock مناسب اجرا کن؛ بعد health check و سپس rollout.
5. برای deploy از ریشهٔ پروژه `runflare deploy` و انتخاب Project/Service طبق CLI رسمی استفاده کن. service و process درست را از Runflare پنل مشخص کن.
6. پس از deploy، anonymous access، ورود مالک، تغییر رمز، session invalidation، API direct access، DB connectivity، export و logs بررسی شوند.
7. اگر migration یا deploy خراب شد، rollback به کد قبلی و دستور restore DB مستند و از پیش آماده باشد. migration destructive بدون backup، approval و rollback اجرا نشود.

## ۱۶. معیار پذیرش فنی

### امنیت

- anonymous و user عادی Shopro نمی‌توانند admin page، API، export یا receipt دانلود را بخوانند.
- username/password فقط از server-side flow می‌گذرد؛ password hash شده؛ هیچ رمز ثابت در bundle/DB/log نیست.
- فقط یک account admin قابل bootstrap است؛ bootstrap idempotent و reset-نشدنی در deployهای بعدی است.
- session امن است؛ logout/revoke/password-change سمت سرور کار می‌کند.
- CSRF، rate limit، no wildcard CORS، generic auth errors و audit event برای تغییر حساس برقرار است.

### عملکرد

- جست‌وجو، چند فیلتر، sort، pagination، یادداشت، تغییر وضعیت، export و بازهٔ زمانی کار می‌کنند.
- عملیات حساس تأیید و دلیل می‌خواهد.
- دادهٔ dashboard با فیلتر بازه و فرمول تعریف‌شده سازگار است؛ دادهٔ ساختگی در production نیست.
- RTL، Bootstrap-like, موبایل، Jalali و Rial/Toman درست نمایش داده می‌شوند.
- جریان فروش و فروشگاه فعلی Shopro unchanged behavior دارد.

### تحویل

- فایل‌های Runflare env/deploy به زبان فارسی و با نام دقیق serviceها و مسیر اجرای دستور آماده‌اند.
- بخش‌هایی که به مقدار مالک نیاز دارند با placeholder مشخص‌اند؛ دامنه، secret، DB credential یا feature ناموجود حدس زده نمی‌شوند.
- خلاصهٔ migration، ریسک‌ها، backup/rollback، دستور deploy، restart و بررسی logs تحویل می‌شود.

## ۱۷. منابع مرجع

### Runflare

- [شروع به کار و ساخت Project با frontend/backend/database](https://runflare.com/docs/get-started/)
- [ایجاد سرویس](https://runflare.com/docs/create-service/)
- [استقرار با CLI](https://runflare.com/docs/work-with-cli/cli-deploy/)
- [تنظیم متغیر محیطی و Secret](https://runflare.com/docs/setup-environment-variable/)
- [PostgreSQL و اتصال داخلی/Remote](https://runflare.com/docs/postgres/)

### OWASP

- [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Session Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
- [CSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)
