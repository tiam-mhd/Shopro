import type { ImgHTMLAttributes } from "react";

type BrandLogoProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "className"> & {
  className?: string;
};

export function BrandLogo({ alt = "لوگوی شاپرو", className = "", ...imageProps }: BrandLogoProps) {
  return <picture
    className={`brand-logo ${className}`.trim()}
    {...(alt ? { role: "img", "aria-label": alt } : {})}
  >
    <img {...imageProps} className="brand-logo-light" src="/icons/Logo.webp" alt="" aria-hidden="true" />
    <img {...imageProps} className="brand-logo-dark" src="/icons/Logo-dark.webp" alt="" aria-hidden="true" />
  </picture>;
}
