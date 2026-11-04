import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function StorefrontPublicFrame({ children, storeSlug, accountPage = false }: { children: ReactNode; storeSlug?: string; accountPage?: boolean }) {
  return <div className="sf-page" dir="rtl">
    <div className="sf-topline"><div className="sf-topline-inner">
      <Link to="/" className="sf-logo"><span>ش</span> شاپرو</Link>
      <span>فروش آنلاین شعبه</span>
      {storeSlug && (accountPage
        ? <Link to={`/s/${encodeURIComponent(storeSlug)}`} className="sf-account-link">بازگشت به فروشگاه</Link>
        : <Link to={`/s/${encodeURIComponent(storeSlug)}/account`} className="sf-account-link">ورود و سفارش‌های من</Link>)}
    </div></div>
    {children}
    <footer className="sf-footer">پرداخت به کارت مقصد فروشگاه انجام می‌شود. شاپرو اطلاعات کارت بانکی مشتری را دریافت نمی‌کند.</footer>
  </div>;
}
