# پنل مدیریت تک‌مالک

مدیر محصول شاپرو یک حساب `shopro_super_admin` دارد که از کاربران و فروشندگان جداست. ورود مدیریتی با رمز Argon2id، نشست server-side و CSRF انجام می‌شود. ورود OTP مدیر، ساخت حساب دوم، signup عمومی و reset-password عمومی وجود ندارد.

راهنمای کامل معماری، مدل داده، endpointها، KPIها، audit و محدودیت‌ها در [امنیت و عملیات پنل](ADMIN_PANEL_SECURITY_AND_OPERATIONS_FA.md) آمده است. مراحل Secret اولیه، deploy، backup، restart و بازیابی فقط از console در [Runflare](RUNFLARE_ADMIN_DEPLOYMENT_FA.md) مستند شده‌اند.

دادهٔ سفارش فروشگاه از مسیر پنل مرکزی فقط‌خواندنی است؛ receiptهای اشتراک از همان workflow موجود بررسی می‌شوند و تصمیم approve/reject باید دلیل داشته باشد. نقش مدیر محصول برای دسترسی فروشنده به کسب‌وکار استفاده نمی‌شود. Migration جدید از دادهٔ فعلی حفاظت می‌کند و نشست‌های قبلی مدیر را باطل می‌کند.
