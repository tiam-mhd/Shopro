# پرامپت جامع پیاده‌سازی از صفر تا انتشار
## PWA فارسی فروش و حسابداری کسب‌وکار

این پرامپت را به Codex یا عامل برنامه‌نویس بدهید. اگر فایل مشخصات فنی جامع کنار آن موجود است، آن سند منبع اصلی الزامات باشد.

---

### نقش و هدف

تو یک تیم کامل محصول و مهندسی هستی: معمار نرم‌افزار، طراح تجربه‌ی کاربری فارسی، مهندس فرانت‌اند و بک‌اند، متخصص پایگاه داده، امنیت و کیفیت.

یک نرم‌افزار کامل، قابل‌استفاده و قابل‌گسترش برای مدیریت فروش، خرید، انبار، دریافت و پرداخت و حسابداری کسب‌وکار بساز. خروجی فقط طرح، wireframe، کد نمونه یا فهرست کار نباشد؛ برنامه‌ی واقعی با فرانت‌اند، API، پایگاه داده، migration، احراز هویت، عملیات مالی و PWA آماده کن.

نام تجاری هنوز تعیین نشده است. در UI از نام خنثی و قابل‌تنظیم مانند «مدیریت کسب‌وکار» استفاده کن؛ نام، لوگو یا رنگ برند قطعی اختراع نکن. اگر تصاویر mockup قبلی ارائه شده‌اند، آن‌ها را راهنمای چیدمان بدان و تعاملات واقعی را بهتر و کامل‌تر از تصویر پیاده‌سازی کن.

---

### قواعد شروع کار

1. ابتدا مخزن، فایل‌های موجود، نسخه‌ی runtime، AGENTS.md و مستندات پروژه را بررسی کن. اگر مخزن خالی است، از صفر بساز. اگر کد موجود است، بدون حذف قابلیت‌های سالم آن را توسعه بده.
2. تصمیم‌های تکنیکی را ثبت کن؛ نسخه‌های پایدار جاری را از مستندات رسمی بررسی و در lockfile قفل کن. وابستگی پیش‌انتشار یا بدون نگهداری فعال انتخاب نکن.
3. پس از بررسی، پیاده‌سازی را شروع کن و تا رسیدن به خروجی قابل‌اجرا ادامه بده؛ فقط برنامه یا اسکلت تحویل نده.
4. هر جا جزئیات غیرحیاتی نامشخص است، از پیش‌فرض‌های این پرامپت استفاده کن. برای نام برند، نرخ مالیات، روش ارسال پیام و اطلاعات تولیدی، placeholder/config قابل‌تغییر بساز؛ اطلاعات واقعی یا credentials را حدس نزن.
5. دکمه‌ی نمایشی، فرم صوری، داده‌ی مالی جعلی در production، localStorage به‌جای persistence سرور یا API ساختگی ممنوع است.
6. هیچ عملیات مالی موفق نشان داده نشود مگر سرور آن را اتمیک ثبت کرده باشد؛ هنگام خطای شبکه فرم را حفظ و وضعیت pending را واضح نشان بده.
7. کد را ماژولار، تایپ‌شده، قابل‌نگهداری، مستند و امن نگه دار. نام‌گذاری کد انگلیسی و snake_case/camelCase؛ تمام متن UI فارسی باشد.

---

### فناوری‌های پایه

در صورت نبود تعارض با مخزن موجود، از این معماری استفاده کن:

- Frontend: React + TypeScript + Vite
- Backend: NestJS + TypeScript REST API با prefix /api/v1
- Database: PostgreSQL
- ORM/Migrations: Prisma به‌همراه migrationهای بازبینی‌پذیر
- PWA: vite-plugin-pwa، manifest و service worker سفارشی
- UI: Tailwind CSS با design tokens، کامپوننت‌های دسترس‌پذیر و RTL
- State: TanStack Query برای server state؛ React Hook Form + Zod برای فرم
- تقویم: date-fns-jalali و کامپوننت JalaliDatePicker اختصاصی
- آزمون: unit، API/database integration و Playwright برای مسیرهای حیاتی
- پیوست‌ها: adapter محلی توسعه و فضای S3-compatible در تولید

پروژه را به صورت monorepo قابل اجرا محلی سازمان بده، مانند apps/web، apps/api، packages/shared و prisma. فایل env.example، Docker Compose توسعه، seed داده‌ی نمونه‌ی development و README فارسی بساز. اسرار و credential واقعی را commit نکن.

---

### محصول و تجربه‌ی کاربری

رابط فارسی، راست‌چین، موبایل‌محور، نصب‌پذیر و واکنش‌گرا برای Android و iOS بساز. زبان، تقویم، اعداد، پول، خطاها، PDF و گزارش‌ها فارسی باشند.

#### طراحی

- طراحی خلوت و ممتاز: پس‌زمینه‌ی روشنِ گرم، متن زغالی، سبز زمردی برای اقدام اصلی، کهربایی ملایم برای هشدار، کارت‌های ساده، حاشیه‌های کم‌رنگ و فضای سفید کافی.
- theme روشن/تاریک با کنتراست مناسب و تنظیم خودکار/دستی.
- فونت فارسی محلی و آفلاین، ترجیحاً Vazirmatn با رعایت مجوز.
- از CSS logical properties استفاده کن؛ جابه‌جایی RTL را با چرخاندن کورکورانه‌ی کل UI انجام نده.
- هدف لمسی مناسب موبایل، safe area برای iPhone، فوکوس صفحه‌کلید، برچسب screen reader و prefers-reduced-motion.
- صفحه‌ی خانه حداکثر ۵ اقدام پرتکرار داشته باشد.
- progressive disclosure: فیلدهای اجباری در روال سریع؛ مالیات، تخفیف پیشرفته، توضیح، پیوست و جزئیات حسابداری زیر «جزئیات بیشتر».
- فلوهای فروش/هزینه/دریافت باید کوتاه باشند و خلاصه‌ی مالی همیشه قبل از ثبت دیده شود.
- از نمایش اعداد یا نمودار بدون واحد پول، از فروش با دریافتی یکی‌گرفتن و از سود بدون تعریف اجتناب کن.
- جست‌وجو و ورودی‌های متنی، «ی/ي»، «ک/ك»، ارقام فارسی/عربی/لاتین و فاصله‌های عربی را درست مدیریت کنند؛ متن اصلی کاربر را بی‌اجازه بازنویسی نکن.

#### صفحات

حداقل این صفحات را واقعی و به API متصل پیاده‌سازی کن:

1. ورود، خروج و بازیابی رمز
2. راه‌اندازی اولیه‌ی کسب‌وکار
3. داشبورد روزانه با فروش، دریافت، هزینه، سود، صندوق و هشدار کمبود موجودی
4. ثبت فروش سریع، انتخاب مشتری، افزودن کالا، مقدار، قیمت، تخفیف/مالیات در صورت فعال بودن، روش پرداخت و خلاصه
5. فاکتورها: فهرست، جست‌وجو، فیلتر، جزئیات، چاپ/PDF، برگشت یا ابطال مجاز
6. مشتریان/تأمین‌کنندگان، جزئیات طرف‌حساب، گردش، مانده، ثبت دریافت/پرداخت
7. فهرست/فرم کالا و خدمت، دسته، قیمت، بارکد و واحد
8. موجودی، حرکت کالا، اصلاح با دلیل و شمارش
9. ثبت خرید و فاکتور خرید، ورود موجودی و بدهی تأمین‌کننده
10. ثبت هزینه با دسته، مبلغ، حساب، تاریخ، توضیح و پیوست
11. حساب‌های نقدی/بانکی، تراکنش‌ها، دریافت، پرداخت، انتقال و بستن صندوق
12. گزارش فروش، سودوزیان، نقدینگی، دریافتنی/پرداختنی، هزینه و موجودی
13. دفترکل/تراز آزمایشی فقط برای نقش مجاز
14. کاربران، نقش‌ها، کسب‌وکار، قالب فاکتور، واحد نمایش، منطقه زمانی، پشتیبان‌گیری و تنظیمات
15. نوار وضعیت اتصال، صف آفلاین، sync و حل تعارض

ناوبری موبایل حداکثر پنج مقصد اصلی داشته باشد؛ عملیات مرتبط از همان صفحه در دسترس باشد.

---

### فارسی، تاریخ و مبلغ

#### زبان و عدد

- root document: lang=fa, dir=rtl.
- پیش‌فرض نمایش اعداد فارسی؛ پذیرفتن ورودی فارسی، عربی و لاتین.
- پیش از parse، ارقام و جداکننده‌ها به شکل canonical تبدیل شوند؛ مقدار DB همیشه عدد استاندارد باشد.
- formatters مشترک برای تاریخ، تعداد، درصد و پول بساز؛ کپی/اشتراک مقدار هم قابل‌فهم باشد.

#### تقویم جلالی

- تقویم UI از شنبه تا جمعه، ماه و سال جلالی، رفت‌وآمد ماه/سال، امروز/دیروز و انتخاب بازه داشته باشد.
- تقویم، کبیسه و تعداد روز ماه را با کتابخانه‌ی معتبر date-fns-jalali محاسبه کند؛ الگوریتم جلالی را دستی نساز.
- از input type=date به عنوان تقویم اصلی استفاده نکن.
- تاریخ انتخاب‌شده در UI جلالی است اما به Gregorian ISO DATE در API/دیتابیس تبدیل شود. تاریخ جلالی را به صورت رشته‌ی آزاد ذخیره نکن.
- txn_date، created_at و timezone را از هم جدا نگه دار: txn_date یک تاریخ مدنی کسب‌وکار است؛ created_at زمان UTC است؛ timezone پیش‌فرض Asia/Tehran.
- گزارش روزانه/ماهانه و مرز نیمه‌شب بر اساس timezone کسب‌وکار باشند، نه timezone دستگاه.
- آزمون‌های ماه‌های ۳۱/۳۰ روزه، اسفند کبیسه، مرز سال، تاریخ نامعتبر، نیمه‌شب Tehran و بازه‌های گزارش را اضافه کن.

#### ریال و تومان

- واحد پایه فقط IRR و storage به عدد صحیح ریال با BIGINT یا NUMERIC(20,0).
- ۱ تومان = ۱۰ ریال. مقدار تومان بعد از parse دقیق ×۱۰ به ریال شود.
- ورودی تومان اعشار حداکثر یک رقم (معادل یک ریال) بپذیرد؛ هیچ گردکردن خاموش انجام نده.
- پول در JavaScript با float محاسبه نشود؛ money type مبتنی بر bigint/decimal بساز و API مبلغ را رشته‌ی ده‌دهی برگرداند.
- واحد نمایشی پیش‌فرض تومان و قابل‌تغییر به ریال؛ کنار همه‌ی inputها، کارت‌ها، مجموع‌ها و خروجی‌ها واحد آشکار باشد.
- یک صفحه یا گزارش فقط یک واحد پولی داشته باشد.
- فرمت رقم فارسی و جداکننده‌ی هزارگان در یک formatter مشترک باشد؛ arithmetic و rounding فقط سمت سرور مرجع نهایی باشد.

---

### امکانات و منطق تجاری

#### فروش و دریافت

- پیش‌نویس، ذخیره‌ی خودکار و ادامه‌ی بعدی؛ مشتری اختیاری فقط برای فروش نقدی مشتری گذری.
- کالا یا خدمت، تعداد دقیق decimal، قیمت، تخفیف و tax snapshot در ردیف.
- روش پرداخت نقد، کارت‌خوان، بانک، اعتباری و پرداخت ترکیبی.
- فروش اعتباری باید مشتری داشته باشد.
- جمع و tax را سرور محاسبه کند، نه client.
- ثبت نهایی فاکتور، دفترکل، حرکت موجودی، پرداخت و تخصیص دریافت اتمیک باشد.
- مانده از total minus valid allocations مشتق شود.
- رسید شامل شماره‌ی قطعی، تاریخ جلالی، واحد، اقلام، دریافت، مانده و راه چاپ/اشتراک.
- برگشت/ابطال با ارجاع و سند معکوس؛ اسناد posted ویرایش یا حذف نشوند.

#### طرف‌حساب

- party type: CUSTOMER/SUPPLIER/BOTH.
- گردش و مانده از دفترکل و پرداخت‌ها به‌دست آید.
- دریافت/پرداخت/فروش/خرید از داخل همان پروفایل قابل شروع باشد.

#### کالا و موجودی

- نوع STOCK یا SERVICE، SKU/بارکد، دسته، واحد، قیمت فروش، بهای خرید، حد هشدار، وضعیت active.
- پیش‌فرض میانگین موزون متحرک و جلوگیری از موجودی منفی.
- موجودی از inventory movements؛ اصلاح تنها با سند تعدیل، دلیل و audit.
- فروش COGS را در لحظه‌ی ثبت snapshot کند؛ فروش خدمت حرکت موجودی نداشته باشد.

#### خرید

- طرف‌حساب، اقلام، مقدار، بهای واحد، تخفیف/مالیات، پرداخت و مهلت؛ ثبت خرید موجودی و حساب پرداختنی/صندوق را در یک تراکنش تغییر دهد.

#### هزینه

- مبلغ، دسته، حساب پرداخت، تاریخ و توضیح؛ پیوست امن اختیاری.
- هزینه‌ی پرداخت‌نشده به بدهی/طرف‌حساب ثبت شود؛ صندوق را کم نکند.

#### پول و دفترکل

- صندوق/بانک، دریافت، پرداخت، انتقال، افتتاحیه، بستن صندوق و اختلاف شمارش.
- انتقال پول درآمد یا هزینه نیست.
- هر عملیات posted یک journal entry متوازن ایجاد کند.
- chart of accounts حداقل دارایی/بدهی/سرمایه/درآمد/هزینه و حساب‌های سیستمی فروش، صندوق، دریافتنی، پرداختنی، موجودی، بهای تمام‌شده و مالیات داشته باشد.
- جمع بدهکار=بستانکار؛ خط دفترکل یک‌طرفه؛ source/idempotency یکتا.
- تغییر/حذف سند نهایی ممنوع؛ اصلاح با reversal/adjustment.
- اسناد در closed period فقط طبق نقش و فرایند reopen مجاز باشند.

#### گزارش‌ها

- sales gross/net, discount, returns, receipts, purchases, expenses, profit-loss accrual, cash flow, receivables, payables, inventory valuation, expense categories, ledger/trial balance.
- بازه و فیلتر جلالی؛ تفکیک فروش از دریافت؛ نشان‌دادن مبنای هر شاخص.
- CSV/Excel UTF-8 و PDF فارسی با font embedding.

---

### مدل پایگاه داده

حداقل این مدل‌ها و ارتباط‌ها را بساز؛ قیود نهایی را در PostgreSQL اعمال کن:

- users, businesses, business_members, user_sessions, branches
- parties
- product_categories, units, products, warehouses
- sales_invoices, sales_invoice_lines
- purchases, purchase_lines
- expense_categories, expenses, attachments
- finance_accounts, cash_transactions, payment_allocations
- inventory_movements, inventory_balances projection, stock_counts, stock_count_lines
- ledger_accounts, journal_entries, journal_lines, closed_periods
- audit_events, idempotency_records, sync_records

هر داده‌ی کسب‌وکاری business_id و constraint tenant-scoped داشته باشد. UUID primary key؛ foreign key، index و unique constraint واقعی. مقدار پول integer Rial؛ qty NUMERIC(18,3). فاکتور، ردیف و journal lines snapshot متنی/قیمتی خود را حفظ کنند. مانده و موجودی در صورت caching فقط projection قابل‌بازسازی باشند.

قیدها:

- unique business_id + invoice_no
- no orphan invoice lines, payment allocations, journal lines
- balanced journal entry enforced by domain validation and database transaction; never rely on UI
- allocated amount <= receipt/payment amount; atomic transaction and concurrency-safe validation
- every posted document and journal is idempotent
- no physical delete of posted/financial/audited data
- every API query tenant-scoped
- audit append-only for sensitive changes

---

### API و منطق سرور

API REST با /api/v1، DTO تایپ‌شده و اعتبارسنجی کامل. ماژول‌ها: auth, businesses, parties, products, sales, purchases, expenses, inventory, finance, accounting, reports, exports, sync, audit.

حداقل endpointهای لازم:

- auth login/logout/refresh
- businesses/current
- parties list/create/update/detail/statement
- products list/create/update/detail
- inventory levels/movements/counts/post
- sales list/create draft/update draft/post/detail/void/returns
- receipts/payments/transfers
- purchases list/create/post
- expenses list/create/post
- finance accounts/transactions/cash close
- reports sales/profit-loss/cash-flow/receivables/payables/inventory/trial-balance
- audit-events, sync-operations/status, exports

تمام عملیات مالی از سرویس دامنه‌ی واحد عبور کند که: authorization، تاریخ دوره‌ی باز، محاسبه‌ی totals، کنترل موجودی، idempotency، transaction، journal lines، inventory movements، audit و response را هماهنگ کند. از client totals یا business_id برای مجوز استفاده نکن. برای تراکنش‌های هم‌زمان از قفل/سطح isolation مناسب یا optimistic version و retry قابل‌امن استفاده کن.

---

### احراز هویت و امنیت

- password hashing استاندارد و امن؛ cookieهای secure, httpOnly, sameSite؛ CSRF مناسب.
- refresh/session rotation و امکان revoke.
- rate limit ورود، validation تمام DTOها، جلوگیری از mass assignment و SQL injection.
- نقش‌ها و permissionهای جزئی؛ حداقل OWNER, MANAGER, ACCOUNTANT, CASHIER, VIEWER.
- tenant scope از session membership به‌دست آید، نه از body/query.
- audit بدون token، رمز، داده‌ی حساس یا محتوای کامل فایل.
- فایل‌ها private و با URL محدودزمان؛ نوع، حجم، extension و checksum اعتبارسنجی شود.
- secretها از environment/secret manager؛ .env واقعی وارد Git نشود.
- backup رمزگذاری‌شده و راهنمای restore فراهم شود.
- اطلاعات مشتری به‌اندازه‌ی ضرورت نگهداری و در export role-aware باشد.

---

### PWA، نصب و آفلاین

- HTTPS و manifest با نام قابل‌تغییر، آیکون regular/maskable، start_url، scope، theme/background color و display standalone.
- apple-touch-icon و safe-area iOS.
- Service Worker فقط app shell، فونت، icon و assets versioned را cache کند؛ پاسخ private API و session به cache عمومی وارد نشوند.
- IndexedDB برای پیش‌نویس‌ها و صف محدود آفلاین؛ نه به عنوان DB اصلی و نه منبع دفترکل.
- offline draft status و queue screen با success/pending/failed.
- clientOperationId/idempotency برای sync دوباره.
- تا تایید server، invoice number رسمی یا success toast قطعی نشان نده.
- sync conflict صریح، reviewable و بدون overwrite خاموش باشد.
- offline update/version prompt مانع حذف فرم در حال ویرایش شود.
- راهنمای نصب iOS از Safari به Home Screen و Android از install prompt/منوی مرورگر.
- اعلان‌ها اختیاری و permission فقط پس از اقدام کاربر؛ قابلیت device با feature detection.

---

### عملیات، لاگ، پیکربندی و استقرار

- فایل‌های .env.example و README فارسی با دستورات دقیق راه‌اندازی.
- Docker Compose توسعه شامل PostgreSQL و سرویس‌های لازم.
- migrationهای نسخه‌دار، idempotent seed توسعه، نسخه‌ی schema و روش rollback/forward repair.
- خطاهای API Persian-ready و request_id.
- health/readiness endpoint، structured logs، metrics پایه و alert برای backup/migration failure.
- production: API و web از HTTPS؛ ترجیحاً same-origin API برای cookie؛ secrets خارج کد؛ CORS محدود.
- فایل‌های تولیدی PDF و export دارای retention و دسترسی role-based.
- قابلیت export کامل کسب‌وکار و restore مستند.

---

### آزمون و معیار اتمام

تست‌های واحد برای پول، جلالی و محاسبات؛ integration با PostgreSQL واقعی/تستی؛ E2E با Playwright برای:
1. setup + login
2. فروش نقدی و فاکتور
3. فروش اعتباری و دریافت بعدی
4. خرید و افزایش موجودی
5. هزینه‌ی نقدی و اعتباری
6. انتقال بین حساب‌ها
7. برگشت و ابطال
8. بسته‌شدن دوره و نقش‌ها
9. تقویم جلالی و مرز اسفند/فروردین
10. ارقام و تبدیل ریال/تومان
11. tenant isolation
12. offline draft و sync idempotent

Definition of Done:

- برنامه از راهنمای README روی محیط تازه بالا می‌آید.
- migration و seed اجرا می‌شوند؛ UI به API و PostgreSQL واقعی متصل است.
- جریان‌های فروش، خرید، هزینه، دریافت، پرداخت و گزارش داده‌ی زنده و سازگار دارند.
- همه‌ی journal entries تراز، مانده‌ها مشتق‌شده و idempotency مؤثر است.
- تاریخ جلالی و ریال/تومان در تمام صفحات اصلی یکدست است.
- Android installable، iOS Home Screen-ready، offline status قابل‌فهم است.
- هیچ placeholder عملیاتی در مسیر اصلی باقی نمانده است.
- دسترسی‌ها، audit، backup و خطای شبکه قابل‌بررسی‌اند.
- lint، typecheck، migration validation، تست‌های لازم و build تولید اجرا شده و نتیجه‌ی هرکدام گزارش شده است.
- تحویل نهایی شامل: کد کامل، راه‌اندازی محلی، معماری، متغیرهای env نمونه، حساب demo فقط برای development، محدودیت‌های باقی‌مانده و مراحل استقرار باشد.

---

### ترتیب اجرا

1. بررسی repo و مستندات؛ ثبت ADR و ساخت workspace.
2. طراحی tokens، RTL shell، manifest و route skeleton.
3. schema، migration، seed، auth، tenancy، roles و audit.
4. primitives پول/تاریخ/نرمال‌سازی و آزمون واحد.
5. مشتری/کالا؛ فروش، دفترکل و موجودی به صورت end-to-end.
6. خرید، هزینه، دریافت/پرداخت، حساب‌ها و انتقال.
7. گزارش‌ها و خروجی‌ها.
8. PWA offline/sync و conflict resolution.
9. امنیت، دسترس‌پذیری، migration، backup و deployment.
10. اجرای معیارها، رفع خطا و به‌روزرسانی README.

در پایان، خلاصه‌ی فایل‌ها و قابلیت‌های ساخته‌شده، دستورات اجرای برنامه، نتایج validation/tests، env موردنیاز و محدودیت‌های واقعی را واضح بنویس. صرفاً نگوی «انجام شد»؛ هیچ موفقیت آزمایش‌نشده‌ای را ادعا نکن.

