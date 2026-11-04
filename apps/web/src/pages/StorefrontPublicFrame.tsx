import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, Moon, Sun, UserRound } from "lucide-react";
import { Link } from "react-router-dom";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem("shopro_storefront_theme");
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* Theme storage is optional. */ }
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

export function StorefrontPublicFrame({ children, storeSlug, accountPage = false }: { children: ReactNode; storeSlug?: string; accountPage?: boolean }) {
  const [theme, setTheme] = useState<Theme>(initialTheme);
  useEffect(() => {
    try { localStorage.setItem("shopro_storefront_theme", theme); } catch { /* Theme storage is optional. */ }
  }, [theme]);

  return <div className="sf-page" data-theme={theme} dir="rtl">
    <header className="sf-topline">
      <div className="sf-topline-inner">
        <Link to={storeSlug ? `/s/${encodeURIComponent(storeSlug)}` : "/"} className="sf-logo" aria-label="شاپرو، فروشگاه آنلاین">
          <span className="sf-logo-mark">ش</span>
          <span className="sf-logo-copy"><strong>شاپرو</strong><small>خرید مستقیم از فروشگاه</small></span>
        </Link>
        <nav className="sf-topline-actions" aria-label="دسترسی‌های فروشگاه">
          {storeSlug && <Link to={accountPage ? `/s/${encodeURIComponent(storeSlug)}` : `/s/${encodeURIComponent(storeSlug)}/account`} className="sf-account-link">
            {accountPage ? <><ArrowRight size={16} /><span>بازگشت به فروشگاه</span></> : <><UserRound size={16} /><span>حساب من و سفارش‌ها</span></>}
          </Link>}
          <button type="button" className="sf-theme-toggle" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "فعال‌کردن تم روشن" : "فعال‌کردن تم تیره"} title={theme === "dark" ? "تم روشن" : "تم تیره"}>
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </nav>
      </div>
    </header>
    {children}
    <footer className="sf-footer"><span>خرید امن از فروشگاه شعبه‌ای شاپرو</span><span>پرداخت به کارت مقصد فروشگاه انجام می‌شود؛ اطلاعات کارت بانکی مشتری دریافت نمی‌شود.</span></footer>
  </div>;
}
