# مشخصات فنی اشتراک شعبه‌ای شاپرو و پرامپت پیاده‌سازی

**مخزن مرجع:** [tiam-mhd/Shopro](https://github.com/tiam-mhd/Shopro)  
**کامیت بررسی‌شده:** [`38611b0c7897380fa91a8db8addedc19d5ae42d5`](https://github.com/tiam-mhd/Shopro/commit/38611b0c7897380fa91a8db8addedc19d5ae42d5)  
**تاریخ تهیه:** ۳ نوامبر ۲۰۲۶  
**هدف:** تعریف محصول، قیمت، معماری، امنیت، تجربه کاربری، تست پذیرش و پرامپت کامل برای اضافه‌کردن اشتراک به ازای هر شعبه.

---

## ۱. نتیجه بررسی کامیت آخر

این کامیت بخش بزرگی از اصلاحات ممیزی قبلی را وارد سورس کرده است. گزارش پیاده‌سازی در مخزن می‌گوید توالی شماره اسناد در سطح کسب‌وکار اتمیک شده، مجوز ویرایش عمومی کالا برای صندوقدار بسته شده، گزارش دریافت‌ها به سندهای ثبت‌شده متصل شده، برگشت نقدی و بستن کامل موجودی اصلاح شده و تست‌های واحد/یکپارچه و چند تست بار اضافه شده‌اند.

| مورد | وضعیت در کامیت بررسی‌شده |
|---|---|
| شماره‌گذاری سند بین شعبه‌های یک کسب‌وکار | اصلاح شده؛ گزارش محلی migration و ۲۰۰ تخصیص هم‌زمان را موفق اعلام می‌کند. پوشش posting واقعی همه انواع سند هنوز کامل نیست. |
| ویرایش فیلدهای حساس کالا توسط CASHIER | اصلاح شده؛ گزارش تست سرویس و HTTP را موفق اعلام می‌کند. ماتریس کامل همه endpointها و نقش‌ها هنوز باز است. |
| دریافت‌های داشبورد و فروش برگشتی/باطل‌شده | اصلاح شده؛ گزارش گردش فروش/برگشت و تطبیق دفترکل را موفق اعلام می‌کند. لغو پیش‌نویس پیش از ثبت هنوز آزمون نشده است. |
| تست‌های خودکار و CI | ناقص از دید انتشار. گزارش مخزن از ۵۹ تست، migrationها، integration و load test محلی موفق می‌گوید؛ اما GitHub Actions مربوط به همین کامیت `failure` است و هیچ مرحله‌ی اجرایی در job نمایش داده نشده است. بنابراین CI سبز نیست و ادعای تست محلی در گزارش را باید self-reported دانست، نه اجرای مستقلاً بازتولیدشده در این بررسی. |
| صف آفلاین | ناقص: retry/logout isolation، جلوگیری از تکرار، شروع سرد آفلاین و رمزگذاری IndexedDB آزمون نشده‌اند. |
| PWA موبایل | ناقص: نصب واقعی iOS/Android، WebKit، شروع آفلاین و به‌روزرسانی Service Worker تأیید نشده‌اند. |
| گزارش‌ها/نقش‌های مدیریت | ناقص: دانلود مرورگری CSV، ماتریس کامل نقش‌ها، پذیرش HTTP پنل مدیر سامانه، PDF/Excel و همگام‌سازی عمومی هنوز بازند. |
| پیامک/پروکسی/ممیزی | ناقص: ارسال زنده و IP پروکسی محیط واقعی، و rollback ممیزی برای همه انواع mutation تأیید نشده‌اند. |

جزئیات و تست‌های ادعاشده در [گزارش remediation کامیت](https://github.com/tiam-mhd/Shopro/blob/38611b0c7897380fa91a8db8addedc19d5ae42d5/docs/engineering-remediation.md) آمده است. وضعیت اجرای GitHub Actions را می‌توان در [run مربوط به این کامیت](https://github.com/tiam-mhd/Shopro/actions/runs/41649710070) دید. خود گزارش می‌گوید CI میزبانی‌شده اجرا نشده، درحالی‌که run حاضر با وضعیت شکست ثبت شده؛ از آن run هیچ تست یا build قابل استنادی به‌دست نمی‌آید. این تناقض باید در تسک جدید با اجرای واقعی workflow رفع شود.

**جمع‌بندی ممیزی:** ایرادهای اصلی P1 از نظر کد طبق گزارش پروژه اصلاح شده‌اند؛ اما عبارت «همه‌چیز برطرف شد» هنوز قابل تأیید نیست. به‌خصوص وضعیت CI، تست مرورگر/PWA و پوشش کامل نقش‌ها و برخی مسیرهای مالی نیازمند شواهد اجرایی‌اند. پیاده‌سازی اشتراک نباید این موارد را پس‌رفت دهد.

---

## ۲. تصمیم محصول و قواعد پایه

1. اشتراک در نسخه اول **برای هر شعبه به‌صورت جداگانه** خریداری و تمدید شود؛ انتخاب شعبه پیش از خرید اجباری و در سفارش ذخیره شود.
2. چهار مدت آغازین ۱، ۳، ۶ و ۱۲ ماه باشند. فعلاً تفاوت آن‌ها فقط مدت و قیمت است؛ همه امکانات محصول یکسان است.
3. قیمت و تاریخچه خرید در زمان سفارش snapshot شوند. تغییر قیمت پلن در پنل، سفارش‌های قبلی را عوض نکند.
4. «محدوده/منطقه» در نسخه اول پیاده‌سازی نشود. طراحی دامنه باید امکان افزودن پوشش منطقه‌ای را بدهد، ولی از `scopeId` چندمنظوره و بدون FK اجتناب شود. در نسخه آینده یک مدل منطقه و resolver با رابطه‌های صریح افزوده شود.
5. تا زمانی که درگاه پرداخت انتخاب و پیکربندی نشده، محیط production نباید پرداخت موفق جعلی بسازد. قرارداد درگاه و fake gateway فقط برای تست ساخته شود؛ نبود پیکربندی باید خطای قابل فهم بدهد.
6. تمدید خودکار خاموش باشد. تمدید فقط با اقدام صریح کاربر انجام شود.
7. قیمت‌های این سند پیشنهاد اولیه‌اند و سودآوری آن‌ها بدون داده هزینه زیرساخت، پشتیبانی، پیامک، درگاه، برگشت وجه و مالیات تضمین‌شده نیست.

---

## ۳. قیمت پیشنهادی آغازین

قیمت پایه یک‌ماهه ۴۹۷٬۰۰۰ تومان است. تخفیف سه‌ماهه کم نگه داشته شده تا انتخاب ۶ و ۱۲ ماه جذاب‌تر باشد؛ قیمت سالانه نسبت به خرید دو دوره شش‌ماهه نیز تخفیف اضافه دارد.

| مدت | مبلغ کل (تومان) | مبلغ ذخیره در DB (ریال) | معادل ماهانه | صرفه نسبت به تمدید ماهانه | برچسب پیشنهادی |
|---|---:|---:|---:|---:|---|
| ۱ ماه | ۴۹۷٬۰۰۰ | ۴٬۹۷۰٬۰۰۰ | ۴۹۷٬۰۰۰ | — | شروع |
| ۳ ماه | ۱٬۳۷۹٬۰۰۰ | ۱۳٬۷۹۰٬۰۰۰ | حدود ۴۵۹٬۶۶۷ | ۱۱۲٬۰۰۰ تومان، حدود ۷٫۵٪ | سه‌ماهه |
| ۶ ماه | ۲٬۴۹۰٬۰۰۰ | ۲۴٬۹۰۰٬۰۰۰ | ۴۱۵٬۰۰۰ | ۴۹۲٬۰۰۰ تومان، حدود ۱۶٫۵٪ | پیشنهاد متعادل |
| ۱۲ ماه | ۴٬۲۹۰٬۰۰۰ | ۴۲٬۹۰۰٬۰۰۰ | ۳۵۷٬۵۰۰ | ۱٬۶۷۴٬۰۰۰ تومان، حدود ۲۸٫۱٪ | بیشترین صرفه‌جویی |

سالانه نسبت به دو خرید شش‌ماهه ۶۹۰٬۰۰۰ تومان، حدود ۱۳٫۹٪، کمتر است. در رابط، قیمت نهایی دوره و معادل ماهانه جداگانه و روشن نمایش داده شود؛ تخفیف و مقایسه نباید قیمت نهایی را پنهان کند. گزینه شش‌ماهه می‌تواند نشان «محبوب» داشته باشد، اما هیچ گزینه‌ای از پیش انتخاب نشود.

**مبنای واحد پول:** تمام محاسبات و API بر حسب عدد صحیح ریال باشد؛ رابط فارسی تومان نمایش دهد. هر تومان دقیقاً ۱۰ ریال است. اعداد با `float` نگهداری یا محاسبه نشوند. خروجی JSON برای `BigInt` باید رشته‌ی عددی باشد. هنگام نمایش، برچسب «تومان» یا «ریال» کنار مبلغ بیاید تا ابهام ایجاد نشود.

**سنجش سوددهی پیش از انتشار:** برای هر دوره، درآمد خالص را پس از کسر کارمزد درگاه، مبلغ مالیات/تعهدات مصوب و برگشت وجه محاسبه کنید. سپس هزینه متغیر منتسب به شعبه (زیرساخت، ذخیره‌سازی، پیامک و پشتیبانی) را کم کنید. برای دوره سالانه، سقف درآمد ناخالص متوسط فعلی ۳۵۷٬۵۰۰ تومان به‌ازای هر شعبه در ماه است؛ حاشیه خالص از این عدد کمتر می‌شود. قبل از فعال‌سازی عمومی باید مدل هزینه و حداقل حاشیه مشارکت توسط مالک محصول/مالی تأیید شود. پنل مدیریت قیمت زیر حداقل اقتصادی پیکربندی‌شده را رد کند یا هشدار و تأیید مدیر ارشد بخواهد.

قیمت‌های عمومی سرویس‌های مشابه فقط معیار زمینه‌ای هستند و پلن‌ها از نظر امکانات، تعداد کاربر و محدودیت‌ها هم‌ارز نیستند: قیمت‌های اعلامی یک سرویس میانی حدود ۱٫۲ میلیون تومان ماهانه و ۹٫۳۶ میلیون سالانه است؛ سرویس دیگری ۱ میلیون ماهانه و ۹ میلیون سالانه درج کرده؛ پلن اقتصادی یک محصول دیگر حدود ۳٫۵۹ میلیون تومان سالانه با سقف امکانات اعلام شده است. منبع‌ها: [Hyperyek](https://landing.hyperyek.com/)، [Hesabshop](https://hesabshop.com/pricing)، [Kasbar](https://kasbar.ir/). قیمت‌ها ممکن است تغییر کنند.

---

## ۴. معماری و مدل داده پیشنهادی

با توجه به ساختار فعلی، پیاده‌سازی باید از React/TypeScript/Vite در وب، NestJS در API، Prisma و PostgreSQL در داده استفاده کند؛ الگوی احراز هویت، tenant/branch authorization، ثبت ممیزی، pagination و طراحی RTL موجود را توسعه دهد، نه این‌که سامانه موازی بسازد.

مدل منطقی پیشنهادی (نام‌ها را با convention واقعی schema هماهنگ کنید):

| موجودیت | مسئولیت و فیلدهای مهم |
|---|---|
| `SubscriptionPlan` | کد یکتا، نام فارسی، مدت ماه تقویمی، ترتیب نمایش، وضعیت فعال/غیرفعال، برچسب و ویژگی‌های مجاز. پلن‌های اولیه: ۱/۳/۶/۱۲ ماه. حذف فیزیکی ممنوع؛ فقط غیرفعال‌سازی. |
| `SubscriptionPriceVersion` | `planId`، `amountRial BIGINT`، ارز، `effectiveFrom/To`، زمان و مدیر ایجادکننده. نسخه قیمت پس از استفاده immutable باشد. تاریخ شروع دو نسخه فعال برای یک پلن هم‌پوشانی نداشته باشد. |
| `BranchSubscription` | رابطه یکتا با `(businessId, branchId)` و وضعیت کنترلی/تعلیق در سطح شعبه. قید composite FK باید تضمین کند شعبه متعلق به همان کسب‌وکار است. مرجع شعبه مستقیم و تایپ‌شده باشد. |
| `SubscriptionOrder` | سفارش برای یک شعبه و نسخه قیمت مشخص؛ مبلغ ریال و مدت به‌شکل snapshot، وضعیت `PENDING/PAID/FAILED/CANCELLED/REFUNDED`، کاربر ایجادکننده، `idempotencyKey`، زمان‌ها و شناسه مرجع درگاه. |
| `SubscriptionPeriod` | بازه‌های تاریخی حق استفاده؛ `startsAt`، `endsAt`، منبع ایجاد (پرداخت، هدیه/جبران، اقدام مدیر)، سفارش nullable برای اعطای دستی، مدیر/دلیل، زمان ابطال. نگهداری سابقه اجباری؛ دوره‌ها پاک نشوند. |
| `SubscriptionPaymentAttempt` | تلاش‌های پرداخت، نام provider، مبلغ/ارز، وضعیت، شناسه یکتای درخواست/تراکنش خارجی، زمان callback و کد خطای غیرحساس. PAN/CVV یا payload حساس ذخیره نشود. |
| `SystemAdminAudit` | برای تغییر قیمت، فعال‌سازی پلن، اعطای رایگان، تمدید دستی، تعلیق، ابطال، برگشت وجه و تغییر سیاست؛ actor، هدف، دلیل، زمان، correlation ID و metadata حداقلی. از audit trail مدیر سامانه موجود استفاده شود. |

### قیود و روابط دیتابیس

- مبالغ `BigInt` و زمان‌ها `timestamptz` در UTC باشند. تاریخ جلالی فقط در لایه نمایش/ورودی تبدیل شود.
- سفارش و تاریخچه خرید FK محدودکننده به شعبه/پلن داشته باشند؛ حذف Cascade برای تاریخچه مالی ممنوع باشد. حذف شعبه‌ای که تاریخچه دارد باید archive/soft delete شود.
- یکتایی کلیدهای idempotency، شناسه مرجع پرداخت و `(businessId, branchId)` رعایت شود. برای داده‌های چندمستاجری تمام queryها به `businessId` و `branchId` مقید باشند.
- ایندکس‌های لازم حداقل: `(branchId, startsAt, endsAt)` برای دوره‌ها، `(businessId, branchId, createdAt)` برای سفارش‌ها، `(status, createdAt)` برای پنل مدیر و unique provider reference.
- دوره پرداخت‌شده و سفارش موفق immutable از نظر مبلغ، پلن و شعبه بمانند. اصلاح مالی با رکورد اصلاحی/ابطال ممیزی‌شده باشد، نه ویرایش خام تاریخچه.
- ایجاد/پرداخت/اعمال دوره و به‌روزرسانی وضعیت projection در یک تراکنش دیتابیس انجام شود. اگر projection نگه می‌دارید، منبع حقیقت و job بازآشتی‌سازی آن را مستند و تست کنید.

### محاسبه دوره و تمدید

- لحظه‌های ذخیره‌سازی UTC هستند و رابط تاریخ را با timezone صریح `Asia/Tehran` و تقویم جلالی نشان می‌دهد.
- مدت، ماه تقویمی جلالی است: ۱، ۳، ۶ یا ۱۲ ماه. تاریخ انتهایی exclusive است؛ دسترسی تا لحظه `endsAt` برقرار و از آن لحظه منقضی است. اگر روز مقصد در ماه مقصد وجود نداشت، به آخرین روز معتبر همان ماه clamp شود. ساعت محلی تهران حفظ شود. از افزودن تعداد ثابتی میلی‌ثانیه استفاده نشود.
- دوره جدید هنگام تمدید پیش از انقضا از پایان دوره فعلی شروع شود؛ در غیر این صورت از زمان پرداخت تأییدشده شروع شود. روزهای باقی‌مانده از بین نروند.
- تمدیدهای هم‌زمان یک شعبه با transaction و lock مناسب (برای نمونه advisory lock یا optimistic version با retry کنترل‌شده) serialize شوند تا نه زمان گم شود و نه دو دوره روی هم ایجاد شود. شعبه‌های متفاوت مستقل بمانند.
- وضعیت «فعال» از دوره تأییدشده، بازه زمانی و عدم تعلیق محاسبه شود. callback پرداخت به‌تنهایی، پیش از راستی‌آزمایی سروربه‌سرور، حق دسترسی ایجاد نکند.

---

## ۵. چرخه پرداخت و API

درگاه پرداخت باید پشت interface/provider adapter قرار گیرد. درخواست کاربر صرفاً سفارش pending می‌سازد و به صفحه پرداخت هدایت می‌کند؛ تنها callback امضاشده و verify سروربه‌سرور از provider می‌تواند سفارش را paid و دوره را فعال کند. مبلغ، ارز، order reference، وضعیت تراکنش و شناسه provider دوباره بررسی شوند. callback تکراری باید idempotent باشد و نتواند دوره دوم بسازد.

اگر پروژه درگاه فعال ندارد، fake provider فقط در تست و محیط development قابل استفاده باشد. در production وضعیت paid دستی از query string، کلاینت یا endpoint عمومی پذیرفته نشود؛ نبود تنظیمات درگاه باید خرید را با خطای مشخص و ثبت‌شده متوقف کند. جزئیات API درگاه انتخابی در زمان پیاده‌سازی با قرارداد رسمی همان درگاه تطبیق داده شود.

API حداقلی برای کاربران tenant:

| عملیات | رفتار |
|---|---|
| `GET /subscriptions/plans` | فهرست پلن‌های فعال و آخرین قیمت قابل خرید، معادل ماهانه و صرفه‌جویی محاسبه‌شده در سرور. |
| `GET /subscriptions/current?branchId=...` | وضعیت و تاریخ پایان اشتراک همان شعبه؛ ابتدا عضویت کاربر در کسب‌وکار/شعبه کنترل شود. |
| `POST /subscriptions/orders` | فقط نقش مجاز؛ `branchId`, `planId`, `idempotencyKey` می‌گیرد. مبلغ را سرور از نسخه قیمت فعال می‌خواند و از کلاینت قبول نمی‌کند. |
| `GET /subscriptions/orders/:id` | سفارش فقط برای همان کسب‌وکار/شعبه و ایجادکنندگان مجاز قابل مشاهده باشد. |
| `GET /subscriptions/history?branchId=...` | تاریخچه صفحه‌بندی‌شده و scope-bound برای مالک شعبه. |
| webhook درگاه | بدون session کاربر ولی با امضای provider، محدودیت نرخ، بررسی مبلغ/ارز/reference و idempotency؛ پاسخ‌ها و خطاها PII یا secret نداشته باشند. |

مسیرهای مدیر سامانه زیر guard و session جداگانه System Admin فعلی قرار گیرند؛ CSRF و audit برای mutationهای session محور حفظ شود:

- فهرست، ساخت، ویرایش توضیحات، فعال/غیرفعال‌کردن پلن.
- ایجاد نسخه قیمت با تاریخ اثرگذاری و نمایش تاریخچه؛ قیمت نسخه موجود و سفارش‌های قبلی مستقیماً ویرایش نشوند.
- جست‌وجو و فیلتر اشتراک‌ها بر اساس کسب‌وکار، شعبه، پلن، وضعیت و تاریخ؛ نمایش سفارش/پرداخت/دوره به شکل صفحه‌بندی‌شده.
- اعطای دوره رایگان، تمدید، تعلیق/رفع تعلیق، ابطال و ثبت برگشت وجه با دلیل اجباری و preview اثر روی شعبه.
- تنظیم حالت rollout و grace period با audit، دسترسی محدود به System Admin مجاز.

---

## ۶. دسترسی، نقش‌ها و رفتار انقضا

- خرید/تمدید از tenant در نسخه اول فقط برای `OWNER` شعبه یا مالک کسب‌وکار مجاز باشد. اگر پروژه permission delegation دارد، خرید را تنها با permission صریح جدید واگذار کنید؛ `CASHIER` و `VIEWER` حق خرید یا تغییر اشتراک نداشته باشند.
- پنل طرح/قیمت و اعطای مدیریتی فقط در پنل مرکزی System Admin باشد؛ منوی تنظیمات عادی کسب‌وکار نباید قیمت سامانه را تغییر دهد.
- احراز نقش کاربر، مالکیت کسب‌وکار و تخصیص شعبه قبل از دسترسی به اشتراک انجام شود. مخفی کردن دکمه در UI کنترل امنیتی نیست.
- پس از انقضا، داده حذف نشود و کاربر بتواند وارد شود، داده را بخواند، شعبه را عوض کند، اشتراک را ببیند و تمدید/پرداخت کند. تمام mutationهای عملیاتی آن شعبه (ثبت/ویرایش فروش، خرید، هزینه، دریافت/پرداخت، موجودی، شمارش، ثبت مالی، import و sync) با خطای پایدار و قابل ترجمه `SUBSCRIPTION_REQUIRED` یا `SUBSCRIPTION_EXPIRED` متوقف شوند. عملیات امنیت حساب و مسیر پرداخت/تمدید از این gate مستثنی باشند.
- gate در سمت API و در یک نقطه مرکزی قابل ممیزی اجرا شود، اما scope آن از request و مجوزهای احراز‌شده استخراج شود؛ branchId ارسالی کاربر به‌تنهایی قابل اعتماد نیست. endpointهای عمومی، webhook، مسیرهای مدیر سامانه و عملیات بدون شعبه را آگاهانه از gate مستثنی یا جداگانه طبقه‌بندی کنید.
- مشتری قبلی را در migration بی‌هشدار قفل نکنید. rollout mode مشخص `DISABLED/OBSERVE/ENFORCE`، گزارش dry-run تعداد شعبه‌های مشمول و grace تاریخ‌دار داشته باشید. قبل از فعال کردن ENFORCE سیاست شعبه‌های موجود را شفاف کنید؛ free access دائمی و پنهان نسازید.
- PWA آفلاین مجاز به دورزدن gate نیست. sync هر mutation را دوباره در سرور بررسی کند. پاسخ انقضا باید به صف آفلاین وضعیت blocked/failed قابل مشاهده بدهد، داده محلی را خودکار حذف نکند و پس از تمدید امکان retry امن با همان idempotency key را فراهم کند.

---

## ۷. تجربه کاربری فارسی و موبایل

- تمام صفحات RTL و mobile-first و سازگار با PWA نصب‌شونده باشند؛ از اجزای طراحی موجود استفاده شود.
- صفحه اشتراک برای **شعبه انتخاب‌شده** نام کسب‌وکار و شعبه را بالای کارت‌ها نشان دهد. اگر چند شعبه هست، قبل از checkout انتخاب شعبه اجباری باشد و branch در خلاصه نهایی تکرار شود.
- وضعیت فعلی: فعال/در grace/منقضی/تعلیق‌شده، نام پلن، تاریخ شروع و پایان جلالی و تعداد روز باقی‌مانده؛ محاسبه معتبر از server time باشد.
- چهار کارت پلن با مبلغ کل، مدت، معادل ماهانه و درصد/مبلغ صرفه‌جویی نمایش داده شوند. برای ۶ ماه «پیشنهاد متعادل» و برای ۱۲ ماه «بیشترین صرفه‌جویی» نشان دهید. مبلغ ریال یا تومان برچسب داشته باشد، مالیات/کارمزد اضافی احتمالی پیش از پرداخت شفاف شود و در صفحه آخر branch + term + final amount خلاصه شود.
- جریان ساده: انتخاب شعبه ← انتخاب مدت ← بررسی نهایی ← پرداخت ← انتظار تأیید سرور ← صفحه نتیجه و رسید. نتیجه از callback معتبر یا polling امن سفارش دریافت شود، نه صرفاً redirect مرورگر.
- حالت‌های loading، خطای شبکه، پرداخت ناموفق، پرداخت در انتظار، callback تکراری، سفارش منقضی، درگاه تنظیم‌نشده و تمدید موفق طراحی شوند.
- بعد از انقضا banner فارسیِ خوانا نمایش داده شود و عملیات مسدودشده توضیح بدهد کدام شعبه نیاز به تمدید دارد. داده واردشده محلی و صف آفلاین حفظ شود.
- فهرست سفارش/رسیدهای قبلی صفحه‌بندی و فیلتر زمانی داشته باشد. تاریخ‌ها جلالی، زمان API ISO/UTC و اعداد فارسی در UI باشند. ورودی مبلغ/قیمت از ارقام فارسی و عربی و لاتین با parser دقیق پشتیبانی کند.
- دسترس‌پذیری: کنتراست، focus، اندازه لمس مناسب، screen reader label، عدم اتکا فقط به رنگ، و کاهش حرکت رعایت شود.

---

## ۸. امنیت، عملیات و مهاجرت

- همه mutationها DTO validation، CSRF در sessionهای cookie، rate limit برای ایجاد سفارش و webhook، کنترل دسترسی در service/API و tenant scoping داشته باشند.
- امضای webhook با الگوریتم/secret رسمی درگاه اعتبارسنجی شود؛ constant-time compare، timestamp/nonce در صورت پشتیبانی، جلوگیری از replay و idempotency پیاده شود. Secret در log، error، response و DB payload خام قرار نگیرد.
- فقط قیمت و پلن معتبر سرور پذیرفته شود؛ کلاینت قادر به ارسال مبلغ دلخواه، branch دیگری، فعال‌سازی دستی یا تغییر order state نباشد.
- callback باید مقدار به واحد درست (ریال/تومان) را در تمام مرزها ثبت کند. برای تبدیل gateway integerها را validate کنید و مبلغ/واحد order را با پاسخ verify مقایسه کنید.
- تراکنش، race condition و callback هم‌زمان تست شوند. قیدهای DB آخرین خط دفاع برای یکتایی و صحت باشند.
- migration قابل rollback صرفاً برای schema در محیط آزمایشی طراحی شود؛ داده مالی حذف یا reset نشود. seed پلن‌ها idempotent باشد و تغییر seed بعدی قیمت live را overwrite نکند.
- کلیدهای پرداخت در env/secret manager؛ برای local و test کلیدهای mock. در log فقط شناسه غیرحساس order/correlation.
- سنجه‌ها و logهای ساختاریافته برای نرخ خرید موفق/ناموفق، callback retry، order pending قدیمی، اشتراک منقضی و خطای gate اضافه شود؛ بدون phone/token/secret.
- یک reconcile command/job بسازید که orderهای paid بدون period، period بدون پرداخت یا projection ناسازگار را گزارش کند و در صورت امکان فقط با مسیر idempotent امن ترمیم کند. خروجی dry-run و audit داشته باشد.
- Backup/restore فعلی باید جدول‌های جدید و روابط/شناسه‌ها را نگه دارد؛ round-trip یک اشتراک paid و یک تلاش پرداخت را پوشش دهد، بدون لو دادن secret در backup.

---

## ۹. برنامه تست و معیار پذیرش

### تست‌های واحد

- محاسبه تخفیف و معادل ماهانه با اعداد صحیح و ثابت‌های قیمت بالا.
- تبدیل تومان↔ریال برای ورودی فارسی، عربی، لاتین، صفر، عدد بزرگ و ورودی نامعتبر؛ رد overflow و float.
- محاسبه ۱/۳/۶/۱۲ ماه جلالی، آخر ماه، اسفند کبیسه/غیرکبیسه، تغییر سال و timezone تهران؛ بررسی `endsAt` exclusive.
- وضعیت فعال/منقضی/تعلیق/لغو، grace و زمان boundary در یک میلی‌ثانیه قبل/در/بعد از انقضا.
- الگوریتم تمدید فعال، تمدید پس از انقضا، برگشت از درگاه، refund/revoke و عدم ساخت دوره با پرداخت ناموفق.

### تست PostgreSQL و migration

- deploy روی DB خالی، migration از schema فعلی و اجرای دوباره migration/seed بدون رکورد تکراری.
- قیمت‌گذاری seeded هر چهار پلن، تاریخچه نسخه قیمت، تغییر قیمت آینده و اثبات این‌که order قبلی مبلغ خود را نگه می‌دارد.
- composite FK جلوگیری از نسبت دادن branch کسب‌وکار A به سفارش business B؛ query isolation بین کسب‌وکارها.
- حذف/آرشیو شعبه دارای سفارش، constraintهای unique و ایندکس‌های موردنیاز.
- backup/restore و reconcile برای order/period/payment attempt.

### تست پرداخت و idempotency

- موفقیت/شکست/انصراف/timeout، callback دیررس، callback تکراری و retry شبکه.
- امضای نامعتبر، amount یا currency اشتباه، reference ناشناخته، order متعلق به tenant دیگر، order منقضی و provider mismatch باید رد و audit امن شوند.
- دو webhook هم‌زمان برای یک پرداخت فقط یک period ایجاد کنند.
- دو سفارش تمدید یک شعبه که هم‌زمان پرداخت می‌شوند، دوره را با lock و ترتیب قطعی extend کنند؛ هیچ روزی گم نشود و بازه ناخواسته دوبار منظور نشود.
- `idempotencyKey` یکسان با payload یکسان همان سفارش را برگرداند؛ همان کلید با branch/plan متفاوت با conflict رد شود.
- fake gateway در production غیرفعال باشد و پرداخت بدون provider واقعی هرگز paid نشود.

### تست مجوز و gate

- جدول نقش‌های `OWNER/MANAGER/ACCOUNTANT/CASHIER/VIEWER` × خرید، مشاهده، mutationهای مالی/انبار، renewal، System Admin action.
- branch مجاز/غیرمجاز و business tenant درست/غلط برای همه مسیرهای subscription و branch mutation.
- بررسی همه endpointهای نوشتنی API، bulk/import، attachment mutation و offline sync برای enforcement؛ مسیرهای read-only، تمدید، webhook و System Admin نیز از نظر استثنا تست شوند.
- منقضی: تمام writeهای شعبه با status/code پایدار رد؛ read، ورود، سوییچ شعبه و renewal برقرار؛ active branch دیگر همچنان قابل استفاده.
- PWA queue پس از 402 آیتم را نگه دارد، خطای روشن بدهد، پس از تمدید retry کند و با duplicate retry سند دوگانه نسازد.
- System Admin تنها با session و CSRF معتبر پلن/قیمت/اشتراک را تغییر دهد؛ هر mutation با actor، reason و نتیجه audit شود.

### تست سرتاسری و مرورگر

با Playwright یا harness موجود پروژه، از ایجاد tenant/branch تا انتخاب یکی از چهار پلن، fake checkout، callback معتبر، فعال‌شدن entitlement، ایجاد یک سند مجاز، انقضا، رد یک mutation، تمدید و موفقیت مجدد آن را در مرورگر تست کنید. دست‌کم یک مسیر موبایل viewport، RTL، تاریخ جلالی، نمایش تومان، تغییر شعبه و error state را پوشش دهد. دانلود رسید/CSV در مرورگر و نمایش pending/failure هم تست شوند.

تست WebKit/Safari iOS و Chrome Android/PWA install/offline در صورت دسترسی اجرا شود؛ اگر دستگاه یا runner موجود نیست، مورد را شفاف به‌عنوان blocker باز ثبت کنید و ادعای قبولی نکنید. هیچ پرداخت واقعی انجام نشود.

### بار، CI و Definition of Done

- روی fixture بزرگ با حداقل ۱۰٬۰۰۰ شعبه/اشتراک، ۲۰ VU و حداقل ۵ دقیقه، plan list، وضعیت اشتراک، gate و ایجاد سفارش تست شوند. بدون خطای cross-tenant و duplicate. p95 endpointهای اصلی و سربار gate نسبت به baseline گزارش شود؛ p95 gate در DB تستی هدف حداکثر ۵۰ms است یا اختلاف مستدل ثبت شود.
- اجرای واقعی pipeline از clean checkout: `npm ci`, generate, typecheck, migration deploy, seed دوبار، unit, integration با PostgreSQL جدا، migration regression, build و browser smoke. اجرای CI روی GitHub Actions باید log و step داشته و سبز شود؛ status خالی یا job بدون runner قبولی نیست.
- مطابق scriptهای فعلی پروژه تست‌های موجود را اجرا کنید، از جمله `npm test`, `npm run typecheck`, `npm run test:integration:local`, `npm run test:perf:local`, `npm run build` و `npm run test:e2e:browser-smoke`؛ اگر نام/پیش‌نیاز تغییر کرده، اسکریپت واقعی را بررسی و علت را گزارش کنید. تست مخرب را فقط روی DB disposable/loopback اجرا کنید.
- هیچ P1/P2 باز در پرداخت، مجوز، tenant isolation، تاریخچه مالی یا gate. تست‌های جدید واقعاً اجرا و نتیجه‌دار باشند؛ snapshot/fake test به‌تنهایی integration محسوب نشود.
- در پایان فهرست فایل/مهاجرت/API/UI تغییرکرده، راه‌اندازی و متغیرهای محیطی، تصمیم‌های باقی‌مانده (خصوصاً انتخاب درگاه)، نتایج واقعی تست با log/command، موارد اجرا نشده و ریسک rollout ارائه شود. ادعای «بدون باگ» نکنید؛ شواهد و محدوده تست را بنویسید.

---

## ۱۰. پرامپت نهایی برای پیاده‌سازی از ابتدا تا انتها

```text
تو به‌عنوان مهندس ارشد full-stack، مسئول اضافه‌کردن اشتراک مالی شعبه‌ای به شاپرو هستی. کار را واقعاً در همین مخزن پیاده‌سازی کن، تست بگیر و نتیجه را با شواهد گزارش کن؛ صرفاً پیشنهاد یا mockup تحویل نده.

## زمینه قطعی

- مخزن: https://github.com/tiam-mhd/Shopro
- کامیت مبنای این درخواست: 38611b0c7897380fa91a8db8addedc19d5ae42d5. ابتدا وضعیت working tree و HEAD واقعی را بررسی کن؛ تغییرات کاربر را حفظ کن و بدون هماهنگی reset/rebase مخرب نکن.
- معماری موجود طبق سورس: وب React + TypeScript + Vite، API با NestJS، Prisma و PostgreSQL، رابط فارسی RTL و PWA. پیش از تغییر، README، AGENTS.mdها، docs/engineering-remediation.md، schema.prisma، auth/role/branch guards، System Admin session/API، money/date helpers، migrationها، test scripts و CI را بخوان.
- گزارش remediation در همین commit چند مورد را PARTIAL می‌داند. CI فعلی نیز در run مربوطه failure بدون stepهای اجرایی گزارش شده است. وضعیت را مستقل بررسی کن، CI واقعی قابل‌اجرا بساز/اصلاح کن و تست‌های قبلی را خراب نکن.
- این وظیفه شامل implementation، migration، API، UI، امنیت، تست و مستندات است. هیچ deploy، پرداخت واقعی، انتشار، push یا تغییر داده production انجام نده.

## هدف محصول

کاربر برای هر شعبه اشتراک مستقل بخرد. در v1 چهار مدت ۱، ۳، ۶ و ۱۲ ماه داریم و تفاوت طرح‌ها فقط مدت و قیمت است. قیمت اولیه هر شعبه:
  * ۱ ماه: ۴۹۷٬۰۰۰ تومان = ۴٬۹۷۰٬۰۰۰ ریال
  * ۳ ماه: ۱٬۳۷۹٬۰۰۰ تومان = ۱۳٬۷۹۰٬۰۰۰ ریال
  * ۶ ماه: ۲٬۴۹۰٬۰۰۰ تومان = ۲۴٬۹۰۰٬۰۰۰ ریال
  * ۱۲ ماه: ۴٬۲۹۰٬۰۰۰ تومان = ۴۲٬۹۰۰٬۰۰۰ ریال
در UI شش‌ماهه را با برچسب «پیشنهاد متعادل» و سالانه را «بیشترین صرفه‌جویی» نشان بده؛ قیمت کل، معادل ماهانه، میزان صرفه‌جویی و شعبه مقصد شفاف باشد. انتخاب پیش‌فرض نکن. همه مبالغ در DB/API عدد صحیح ریال باشند؛ نمایش با تومان و بدون float انجام شود.

اشتراک‌ها باید بعداً از پنل مدیریت مرکزی سامانه مدیریت شوند؛ مالک کسب‌وکار قیمت پلن را تغییر ندهد. پیاده‌سازی v1 صرفاً branch-scoped باشد. برای منطقه در آینده، resolver/service boundary و روابط typed قابل توسعه ایجاد کن، اما scopeId چندمنظوره یا feature منطقه‌ای نساز.

## مراحل شروع و ممیزی فنی

1. HEAD، status، git diff و تمام instructionها را بررسی کن. کامیت مبنا را با وضعیت فعلی مقایسه کن و موارد PARTIAL گزارش remediation را به‌عنوان ریسک regression بشناس.
2. قبل از تغییر، تست‌های موجود و migration validation را در محیط disposable اجرا کن تا baseline معلوم شود. اگر dependency یا محیط مانع شد، دقیق ثبت کن؛ شکست را به‌عنوان pass گزارش نکن.
3. از conventionهای همین پروژه برای DTO، error codes، pagination، CSRF، CSRF-protected admin session، audit و i18n استفاده کن. الگوی تازه موازی اضافه نکن مگر دلیل فنی مستند داشته باشد.
4. طرح داده و مسیرهای mutation را قبل از کدنویسی map کن؛ همه endpointهای branch-scoped و role matrix را فهرست کن تا enforcement ناقص نماند.

## مدل داده و migration

با نام‌گذاری متناسب repo، مدل‌های معادل این‌ها را اضافه کن:
- SubscriptionPlan: code/nameFa/durationMonths/displayOrder/isActive/badge/features محدودشده.
- SubscriptionPriceVersion: planId، priceRial BigInt، currency، effectiveFrom/effectiveTo، creator/time؛ نسخه مصرف‌شده immutable و تاریخچه‌دار باشد.
- BranchSubscription با unique (businessId, branchId) و composite FK معتبر به شعبه همان business.
- SubscriptionOrder: businessId/branchId، priceVersionId، plan/duration/amount snapshots، state، idempotency key، creator، timestamps و provider reference.
- SubscriptionPeriod: startsAt/endsAt، source (paid/admin grant/compensation)، order nullable، revokedAt، actor/reason. سابقه حذف نشود.
- SubscriptionPaymentAttempt: provider، amount/currency، state، شناسه خارجی یکتا، timestampها و خطای امن؛ هیچ PAN/CVV یا secret خام ذخیره نکن.
- audit برای تغییرات مدیر سامانه با actor، action، target، reason، timestamp و metadata حداقلی؛ اگر audit مستقل System Admin وجود دارد آن را توسعه بده.

قیدها/رفتار:
- تمام amountها BigInt ریال، تمام instantها timestamptz UTC؛ JSON serializer برای BigInt رشته برگرداند.
- branch و business mismatch را با composite FK و server-side authorization ببند. تاریخچه order/period/payment را cascade delete نکن. شعبه دارای تاریخچه soft-delete/archive شود.
- unique idempotency/provider references و indexهای branch+period, business+branch+order date, admin filters ایجاد کن.
- seed چهار پلن/قیمت idempotent باشد؛ اجرای دوباره نه duplicate بسازد و نه قیمت زنده را overwrite کند. تغییر قیمت، نسخه جدید با effective date بسازد.
- migration باید از دیتابیس خالی و schema فعلی upgrade شود؛ داده قبلی پاک نشود. deployment rollout برای مشتریان قبلی گزارش dry-run و grace تاریخ‌دار داشته باشد؛ gate در مرحله اول قابل OBSERVE و سپس ENFORCE باشد.

## محاسبه اشتراک

- مدت را ماه تقویمی جلالی در timezone Asia/Tehran محاسبه کن؛ از جمع میلی‌ثانیه ثابت استفاده نکن. روز مقصد ناموجود را به آخرین روز معتبر ماه clamp کن و ساعت محلی را حفظ کن. از date helper معتبر موجود استفاده کن؛ اگر کافی نیست helper مجزا با تست leap-year و boundary بساز.
- startsAt شامل و endsAt exclusive باشد. درست پیش از endsAt فعال و از همان instant غیرفعال باشد.
- پرداخت اول تنها بعد از verify سروربه‌سرور اشتراک را فعال کند. renewal پیش از انقضا از max(currentEnd, confirmedPaymentTime) و renewal پس از انقضا از زمان تأیید پرداخت شروع شود تا زمان خریداری‌شده از دست نرود.
- برای چند renewal/callback هم‌زمان یک branch از lock/transaction/optimistic version امن با retry کنترل‌شده استفاده کن. دو شعبه مستقل باشند. callback retry باید idempotent باشد و period دوم نسازد.
- پرداخت خودکار خاموش. refund/revoke/suspend فقط از جریان کنترل‌شده و audit شده.

## درگاه پرداخت

- اول integrationهای فعلی را بررسی کن. PaymentGateway/provider adapter تعریف کن و fake gateway را فقط برای تست/local فعال کن.
- کلاینت مبلغ، currency، plan price یا وضعیت PAID را تعیین نکند؛ سرور مبلغ را از نسخه قیمت معتبر بخواند.
- webhook: امضا با روش رسمی provider، بررسی timestamp/replay در صورت پشتیبانی، constant-time signature compare، order/reference/amount/currency/provider تطبیق، rate limit و idempotency داشته باشد. PII و secret در log نریز.
- redirect مرورگر به‌تنهایی پرداخت را قطعی نکند. اگر هیچ provider production تنظیم نشده، خرید با خطای واضح متوقف شود؛ paid جعلی نساز. چون provider هنوز در نیازمندی تعیین نشده، adapter و test fake را کامل کن و انتخاب/credential واقعی را به‌عنوان blocker صریح گزارش بده.

## API و مجوزها

Tenant endpoints حداقل: فهرست planهای قابل خرید، وضعیت فعلی با branchId، ایجاد سفارش idempotent، دریافت وضعیت سفارش، تاریخچه pagination‌شده و webhook provider. نام/route را با convention `/api/v1` پروژه تطبیق بده.

فقط OWNER مجاز به خرید/تمدید در v1؛ نقش‌های دیگر فقط طبق permission صریح موجود و مصوب. هر route باید business membership، branch assignment و tenant isolation را سرور بررسی کند. عدم مجوز نباید وجود سفارش/branch tenant دیگر را افشا کند.

در پنل مرکزی system admin (نه tenant settings) امکانات زیر را بساز:
- CRUD محدود پلن، active/inactive، ترتیب و متن/برچسب.
- افزودن نسخه قیمت با effective date و مشاهده تاریخچه؛ هیچ price version یا order استفاده‌شده را درجا تغییر نده.
- جست‌وجو/فیلتر/صفحه‌بندی اشتراک‌ها، order، payment attempts و وضعیت هر branch.
- grant رایگان، extend، suspend/unsuspend، revoke/refund با reason اجباری و audit.
- تنظیم/نمایش rollout mode و grace با دسترسی system admin فعلی و CSRF. هر mutation با تست HTTP واقعی و audit rollback بررسی شود.

## Entitlement gate و انقضا

- API تمام writeهای مالی/انبار branch را بعد از احراز کاربر و تعیین scope، در یک gate مرکزی قابل ممیزی بررسی کند؛ صرف پنهان‌کردن button کافی نیست. endpointها را enumerate کن: sales/returns/void, purchases, expenses, receipts/payments, finance journals/periods, stock movement/count, imports/attachments/bulk, offline sync و هر mutation جدید.
- active branch باید entitlement فعال داشته باشد. subscription expired/suspended mutations را با HTTP status سازگار و code پایدار `SUBSCRIPTION_EXPIRED`/`SUBSCRIPTION_REQUIRED` متوقف کند؛ message و payload برای UI فارسی قابل ترجمه باشد.
- بعد از انقضا اجازه بده کاربر وارد شود، read-only داده را ببیند/export مجاز کند، شعبه را عوض کند، status/تاریخچه را ببیند و تمدید/پرداخت کند. داده را حذف یا مخفی نکن. عملیات امنیت حساب و System Admin routeها طبق policy جدا باشند.
- PWA queue هنگام sync gate سرور را رعایت کند. روی خطای اشتراک آیتم را حذف نکند؛ status و توضیح قابل دیدن بدهد؛ پس از تمدید retry با idempotency key همان آیتم ممکن باشد. آفلاین راه دور زدن backend نیست.
- برای مشتری‌های موجود، اول OBSERVE/dry-run و گزارش شعبه‌های بدون اشتراک بساز. enforce از طریق تنظیم مدیر سامانه/rollout صریح باشد و به داده موجود grace تاریخ‌دار بدهد؛ هیچ وضعیت رایگان بی‌انقضا را پنهانی seed نکن.

## UX فارسی

- UI موبایل‌محور، RTL و منطبق با design system فعلی. انتخاب/نمایش شعبه قبل از پرداخت ضروری باشد.
- نمایش وضعیت فعلی، پلن، شروع/پایان جلالی در Asia/Tehran و روزهای باقی‌مانده بر اساس server time.
- کارت‌های ۱/۳/۶/۱۲ ماه با قیمت کل، معادل ماهانه و saving؛ مبلغ نهایی قبل checkout، نام branch و هر هزینه/مالیات احتمالی واضح. هیچ مبلغ اضافه پنهانی.
- flow: انتخاب شعبه → پلن → تأیید خلاصه → رفتن به gateway → pending/verify → نتیجه قطعی سرور. حالات شکست، cancel، timeout، callback pending/replay و provider unconfigured طراحی شوند.
- صفحه سفارش‌های قبلی، رسید/شناسه، pagination؛ هشدار انقضا و CTA تمدید. دسترسی‌پذیری، touch target، focus، screen reader و نمایش اعداد فارسی.
- برچسب ریال/تومان هرجا لازم؛ قیمت‌گذاری در UI از API برسد، نه تکرار hard-coded پراکنده.

## اقتصاد پلن

فرمول گزارش مدیریتی را پیاده کن: gross price، fee provider، tax/obligation طبق تنظیم مصوب، refunds، variable infra/storage/SMS/support allocation و net contribution. قیمت هر پلن در v1 بالا seed شود. cost input و حداقل contribution به شکل تنظیم قابل audit باشد. سودآوری را تضمین‌شده معرفی نکن؛ میانگین قیمت سالانه ۳۵۷٬۵۰۰ تومان در ماه/شعبه پیش از هزینه‌هاست. اگر هزینه/مالیات مشخص نیست، در پنل آن را unknown اعلام کن و فعال‌سازی/قیمت زیر floor را با warning یا acknowledgment کنترل کن؛ نرخ مالیات را حدس نزن.

## تست‌های الزامی

Unit: تمام قیمت/تخفیف/تبدیل عددی و ارقام فارسی؛ جلالی و پایان ماه/اسفند کبیسه/سال/Tehran timezone؛ state و مرز پایان؛ تمدید/انقضا/grace.

Postgres: fresh deploy و upgrade از schema موجود، migration دوباره، seed دوباره، FK branch-business، price history، order snapshots، archive branch، backup/restore.

Payment: success/fail/cancel/timeout, invalid signature, wrong amount/currency/provider, unknown/foreign reference, callback duplicate/replay/concurrent, same idempotency key vs conflicting payload, simultaneous renewal same/different branches, fake provider disabled in production.

Auth/gate: matrix OWNER/MANAGER/ACCOUNTANT/CASHIER/VIEWER؛ owner/tenant/branch allow-deny؛ همه routeهای write از inventory؛ expired branch read-only/renewal allowed, all business writes blocked; another active branch still works; admin separated session/CSRF/audit; offline sync preserves failed item and retry doesn't duplicate.

E2E مرورگر: create test business/branch, choose all four plans, fake checkout success and failure, order history, active branch write, expiry 402, Persian message, renew, write restored, branch switching, mobile RTL layout, CSV/receipt download. هیچ پرداخت واقعی نکن.

Performance: synthetic DB حداقل 10,000 branch subscription، 20 VUs و حداقل 5 min برای plan/current/gate/order؛ error rate صفر، no cross-tenant leaks, p95 metrics; target gate incremental p95 ≤50ms یا مستندکردن deviation.

## اجرا و معیار Done

- migration و seed را روی DB disposable اجرا کن؛ هیچ تستی روی production یا user data اجرا نشود.
- همه تست‌های موجود را نگه دار و تمام تست‌های جدید را واقعاً اجرا کن. حداقل runهای مرتبط فعلی: `npm test`, `npm run typecheck`, `npm run test:integration:local`, `npm run test:perf:local`, `npm run build`, `npm run test:e2e:browser-smoke` و migration regression. پیش‌نیاز/نام script را از package.json واقعی بخوان و نتیجه واقعی را ثبت کن.
- CI GitHub Actions را بازتولید و اصلاح کن تا checkout clean همه قدم‌ها را اجرا کند و نتیجه همراه logs/status واقعی داشته باشد. job بدون steps، status خالی یا فقط گزارش متنی «pass» قبول نیست.
- اگر Safari/iOS/Android یا درگاه sandbox در دسترس نیست، آن را به‌صورت open blocker بنویس؛ ادعای تست انجام‌نشده نکن.
- Definition of Done: migration امن و seed idempotent؛ چهار قیمت درست؛ subscription per branch با تمدید درست؛ پنل مدیر مرکزی و audit؛ همه writeها سروری gate شوند؛ tenant/role isolation کامل؛ پرداخت verify و idempotent؛ PWA و UX قابل استفاده؛ همه تست‌های قابل اجرا pass؛ CI سبز واقعی؛ هیچ P1/P2 باز در مجوز، پرداخت، تاریخچه یا gate.
- در پاسخ نهایی خلاصه تغییرها، فایل‌های مهم، migration، endpointها، flow کاربر/admin، env/secrets لازم، قیمت و قواعد، commands و نتایج تست واقعی، log/CI link، تست‌های انجام‌نشده و blocker انتخاب درگاه را ارائه بده. هیچ push، merge یا deploy بدون مجوز جدا انجام نده.
```

---

## ۱۱. تصمیم‌هایی که پیش از فروش واقعی باید مشخص شوند

این موارد مانع نوشتن core و تست محلی نیستند، اما قبل از فعال‌سازی پرداخت واقعی باید مالک محصول/مالی تأییدشان کند:

1. انتخاب درگاه و مقدار واقعی کارمزد/واحد مبلغ.
2. اینکه قیمت‌های جدولی قیمت نهایی شامل تعهدات مالیاتی مصوب باشند یا breakdown جدا داشته باشند؛ هیچ مبلغی نباید در مرحله آخر ناگهانی اضافه شود.
3. مدل هزینه واقعی هر شعبه و حداقل حاشیه سود قابل قبول.
4. سیاست شعبه‌های فعلی هنگام rollout: دوره‌ی grace و تاریخ enforce.
5. سیاست برگشت وجه، لغو سفارش pending و جبران اشتباه پرداخت.

تا تعیین این تصمیم‌ها، محیط test و fake gateway باید همه flowها را پوشش دهد، ولی پرداخت production را موفق‌سازی نکند.
