# استقرار روی Runflare

## چیدمان کم‌هزینه

برای این مخزن، دو آیتم استقرار کافی است:

1. یک سرویس Docker که build رابط React/PWA و API NestJS را در یک سرویس ارائه می‌کند.
2. یک سرویس PostgreSQL در همان پروژه Runflare.

Dockerfile در ریشه مخزن است و پورت `3000` را ارائه می‌کند. API و وب از یک origin استفاده می‌کنند؛ در نتیجه سرویس فرانت‌اند جداگانه لازم نیست. پایگاه داده را داخل کانتینر برنامه نسازید؛ دادهٔ عملیاتی باید در سرویس PostgreSQL بماند.

## راه‌اندازی اولیه

1. در Runflare یک پروژه بسازید و کلاستر/منطقهٔ موردنظر را انتخاب کنید.
2. در همان پروژه یک سرویس PostgreSQL بسازید و یک نام کاربری، رمز و دیتابیس انتخاب کنید.
3. یک سرویس Docker بسازید. مخزن GitHub عمومی `https://github.com/tiam-mhd/Shopro` و شاخهٔ `main` را به آن متصل کنید؛ Dockerfile در ریشه است. برای مخزن عمومی، اتصال OAuth برنامهٔ Runflare ساده‌ترین روش است. دریافت خودکار را فقط پس از اولین استقرار فعال کنید.
4. متغیرهای فایل [`../infra/runflare.env.example`](../infra/runflare.env.example) را در تنظیمات محیطی سرویس Docker، بخش Bulk Edit، وارد کنید. `DATABASE_URL` را از جزئیات اتصال داخلی سرویس PostgreSQL بگیرید. Host باید آدرس داخلی سرویس Postgres در Runflare باشد؛ آدرس remote را فعال نکنید. `TRUST_PROXY_HOPS=1` فرض می‌کند یک reverse proxy جلوی کانتینر است؛ اگر مسیر شبکه تعداد دیگری دارد، مقدار را با همان تعداد hop مورداعتماد هماهنگ کنید. متغیرهای secret را در Runflare به حالت Secret تنظیم کنید.
5. پورت سرویس Docker را در صورت درخواست Runflare روی `3000` بگذارید. دامنه را به همین سرویس Docker وصل کنید، گواهی رایگان SSL رانفلر را برای دامنه فعال کنید، سپس `WEB_ORIGIN` را با origin نهایی `https://...` مقداردهی کنید. `COOKIE_SECURE=true` فقط وقتی درست است که HTTPS برای آن دامنه فعال باشد.
6. برای فعال‌کردن رسید هزینه، فقط اگر پلن/پنل فعلی Runflare ذخیره‌ساز پایدار و خصوصی ارائه می‌کند، آن را به سرویس Docker متصل و `ATTACHMENT_STORAGE_DIR` را برابر مسیر mount مطلق آن قرار دهید. مسیر باید برای کاربر برنامه قابل‌نوشتن و بیرون از `apps/web/public` و `apps/web/dist` باشد. اگر چنین حجمی در دسترس نیست، این متغیر را خالی بگذارید؛ API بارگذاری/دریافت پیوست را غیرفعال می‌کند و روی دیسک موقت کانتینر فایل نمی‌پذیرد. در این تغییر هیچ volume یا سرویس واقعی ساخته نشده است.
7. پس از بالا آمدن سرویس Docker و دیتابیس، در ترمینال سرویس Docker دستور `npm run db:deploy` را اجرا کنید. این فرمان migrationهای نسخه‌بندی‌شده را اعمال می‌کند؛ برای هر migration جدید نیز آن را پس از استقرار نسخهٔ تازه اجرا کنید.
8. مدیر سامانه را جدا از کاربران کسب‌وکار بسازید:

   ```sh
   npm run admin:create:prod -- --phone 09123456789 --name "نام مدیر"
   ```

9. مسیرهای `https://<domain>/api/v1/health/live` و `https://<domain>/api/v1/health/ready` را بررسی کنید. مسیر دوم اتصال PostgreSQL را هم می‌سنجد.

API در `NODE_ENV=production` پیش از راه‌اندازی، تنظیمات را بررسی می‌کند و با مقادیر نمونه یا ناامن شروع نمی‌شود. باید `COOKIE_SECURE=true`، دو secret تصادفی و متفاوت حداقل ۳۲ کاراکتری، اتصال PostgreSQL داخلی غیر localhost، origin دقیق HTTPS، تعداد proxy hop مشخص، و `PARSGREEN_API_KEY` واقعی وارد شوند. مقدار `ATTACHMENT_STORAGE_DIR` می‌تواند خالی بماند؛ در آن حالت دریافت و بارگذاری رسید غیرفعال است. برای فعال‌کردن رسیدها، مسیر mount مطلق volume خصوصی و پایدار را قرار دهید. جزئیات متغیرها در الگوی env آمده است؛ secret واقعی را در فایل یا مخزن قرار ندهید.

## پارس‌گرین

برای فعال‌شدن ورود OTP، مقدار واقعی `PARSGREEN_API_KEY` را در سرویس Docker و در حالت Secret ثبت کنید. آداپتر فعلی به `https://sms.parsgreen.ir/Apiv2/Message/SendOtp` با API key و بدنهٔ `Mobile` و `SmsCode` درخواست می‌فرستد. ارسال واقعی پیامک بدون توکن معتبر حساب قابل تأیید نیست.

## تنظیمات Runflare و مستندات

- [ایجاد برنامه Docker](https://docs.runflare.com/docker/docker-create-app/)
- [اتصال Docker به GitHub و دریافت خودکار](https://docs.runflare.com/docker/deploy-github/)
- [تنظیم متغیرهای محیطی Docker و Bulk Edit](https://docs.runflare.com/docker/docker-environment-variable/)
- [اتصال داخلی PostgreSQL در Runflare](https://runflare.com/docs/postgres/)
- [فعال‌سازی SSL رایگان](https://runflare.com/docs/how-to-work-with-ssl/)
- [دستورهای Runflare CLI](https://runflare.com/docs/work-with-cli/cli-commands/)
- [دامنه موقت Runflare](https://docs.runflare.com/general/temporary-domain/)

دامنهٔ موقت Runflare یک‌ساعته است و برای بررسی اولیه مناسب است؛ برای مقدار پایدار `WEB_ORIGIN` دامنهٔ نهایی سرویس را تنظیم کنید.
