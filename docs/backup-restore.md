# پشتیبان‌گیری و بازیابی شاپرو

این ابزارها dump کامل PostgreSQL و فایل‌های ثبت‌شده در metadata پیوست هزینه و رسید پرداخت اشتراک را رمزگذاری و بازیابی می‌کنند. فرمان‌ها روی runner جداگانه اجرا می‌شوند؛ API عمومی یا مسیر مدیریتی برای دریافت backup وجود ندارد.

## پیش‌نیاز و مرز امنیت

- Node.js 22، `pg_dump`، `pg_restore`، `psql` و `tar` در runner نصب باشند. نسخهٔ ابزارهای PostgreSQL باید هم‌نسخه یا جدیدتر از سرور باشد.
- runner باید به PostgreSQL و همان فضای خصوصیِ پیوست‌ها دسترسی داشته باشد. `ATTACHMENT_STORAGE_DIR` باید به volume پایدار و خصوصی اشاره کند.
- تمام replicaهای API باید نسخه‌ای داشته باشند که قفل پشتیبان پیوست را می‌شناسد. در مدت dump و آرشیو، افزودن/حذف پیوست موقتاً منتظر می‌ماند؛ عملیات دیگر با snapshot سازگار PostgreSQL ادامه می‌یابند.
- کلید ۳۲‌بایتی Base64 فقط در secret manager runner نگه‌داری شود و نسخهٔ بازیابی آن جدا از volume پشتیبان باشد. فایل backup، کلید و فضای پیوست‌ها نباید در یک volume یا یک دسترسی واحد قرار گیرند.
- مقدار `BACKUP_RETENTION_DAYS` را مالک داده با توجه به سیاست نگه‌داری تعیین می‌کند؛ ابزار مقدار پیش‌فرض نمی‌سازد. پس از ساخت موفق، فقط پوشه‌های backup معتبر شاپرو که از این بازه قدیمی‌ترند حذف می‌شوند.
- ابزارها وارد image برنامه نشده‌اند و هیچ schedule یا مقصد ابری را فرض نمی‌کنند. scheduler باید کد را روی runner خصوصی اجرا کند و خروجی غیرصفر را alert کند. Runflare volume پایدار یا زمان‌بند backup در این محیط پیکربندی یا راستی‌آزمایی نشده است.

یک کلید تازه را با مولد رمزنگاری‌شده بسازید و مستقیماً در secret manager ثبت کنید؛ آن را در مخزن، log یا کنار فایل‌های backup قرار ندهید. نمونهٔ PowerShell برای ساخت مقدار، بدون نوشتن آن در فایل:

```powershell
$backupKeyBytes = New-Object byte[] 32
$randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
$randomGenerator.GetBytes($backupKeyBytes)
$randomGenerator.Dispose()
[Convert]::ToBase64String($backupKeyBytes)
```

برای آزمون کامل و محلی روی یک PostgreSQL موقت، بدون اتصال به دیتابیس موجود، اجرا کنید:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/backup/test-roundtrip.ps1
```

این تست migration/seed، یک رسید نمونه، dump، restore و تطبیق ردیف‌ها و checksum را انجام می‌دهد و کلاستر و فایل‌های موقت خودش را پاک می‌کند.

## گرفتن backup

1. الگوی `infra/backup.env.example` را فقط در محیط runner تنظیم کنید. `DATABASE_URL` باید اتصال همان دیتابیس هدف، `BACKUP_DIR` مسیر مطلق خارج از checkout و `BACKUP_RETENTION_DAYS` سیاست مصوب باشد. اگر جدول پیوست هزینه یا رسید پرداخت رکورد دارد، `ATTACHMENT_STORAGE_DIR` الزامی است.
2. پوشهٔ backup را روی storage خصوصی و جدا از دیتابیس/volume پیوست‌ها بسازید. خروجی شامل `database.dump.enc`، در صورت وجود رسید `attachments.tar.gz.enc`، و manifest فاقد محتوای مالی است.
3. اجرا:

   ```powershell
   npm run backup:create
   ```

   موفقیت با JSON رویداد `backup.completed` و مسیر backup گزارش می‌شود. هر خطای dump، رمزنگاری، قفل، فایل مفقود، checksum نامعتبر یا retention کد خروجی غیرصفر می‌دهد. فایل‌های موقتِ ناقص به‌عنوان backup نهایی منتشر نمی‌شوند.

4. ابزار قبل از dump تمام پیوست‌ها و رسیدهای پرداخت ثبت‌شده در دیتابیس را از نظر اندازه و SHA-256 با فایل خصوصی تطبیق می‌دهد. فقط storage keyهای opaque موجود در جدول‌های metadata در آرشیو می‌روند.

## بازیابی روی محیط دورریختنی

بازیابی عمدی فقط روی PostgreSQL loopback و دیتابیسی خالی با نامی شبیه `shopro_restore_roundtrip` مجاز است. نام مقصد باید هم پیشوند `shopro_restore_` داشته باشد و هم دقیقاً با `RESTORE_CONFIRM_DATABASE` برابر باشد. ابزار از اتصال remote رد می‌شود و اگر schema عمومی مقصد خالی نباشد restore را شروع نمی‌کند.

1. یک دیتابیس دورریختنی روی loopback بسازید و `RESTORE_DATABASE_URL`، نام دقیق تأیید، همان کلید backup و در صورت وجود رسید، یک `RESTORE_ATTACHMENT_STORAGE_DIR` تازه و مطلق تنظیم کنید.
2. پیش از restore، artifactها با checksum manifest و تگ GCM بررسی می‌شوند؛ آرشیو پیوست از نظر مسیر و نوع فایل بررسی می‌شود. پس از restore، جدول‌های اصلی و migrationهای Prisma کنترل و checksum تمام پیوست‌ها دوباره با ردیف‌های دیتابیس تطبیق داده می‌شود.
3. اجرا:

   ```powershell
   npm run backup:restore -- "D:\\shopro-backups\\shopro-backup-<timestamp>-<uuid>"
   ```

4. خروجی `restore.completed` تنها پس از پایان کنترل‌ها چاپ می‌شود. اگر فرایند بعد از commit دیتابیس و پیش از انتقال اتمیک پوشهٔ پیوست شکست خورد، مقصد دیتابیسِ دورریختنی را حذف و restore را از ابتدا تکرار کنید؛ به آن مقصدِ نیمه‌بازیابی‌شده سرویس ندهید.

## شواهد و محدودیت فعلی

- تست‌های رمزنگاری، key نامعتبر، کلید اشتباه، تغییر داده، truncation، هدف loopback و round-trip آرشیو پیوست با `tar` محلی را پوشش می‌دهند.
- در این محیط PostgreSQL loopback درخواست password کرد و credential محلی معتبر در اختیار اجرای تست نبود؛ Docker نیز نصب نبود. بنابراین round-trip کامل `pg_dump → pg_restore` روی دیتابیس disposable در این نوبت اجرا نشد.
- این ابزار قابلیت backup/restore را فراهم می‌کند، اما به تنهایی schedule، مقصد off-site، بازیابی point-in-time، RPO/RTO، کلید جایگزین، alerting یا پنل backup در UI تعیین نمی‌کند. این‌ها باید روی runner و storage واقعی انتخاب و با تمرین بازیابی دوره‌ای اثبات شوند.
