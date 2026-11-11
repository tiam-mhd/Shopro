export function KaashLogo({ className = "", alt = "کاش" }: { className?: string; alt?: string }) {
  return <picture className={`kaash-logo ${className}`.trim()}>
    <img className="kaash-logo-light" src="/icons/kaash-light.webp" width="640" height="640" alt={alt} />
    <img className="kaash-logo-dark" src="/icons/kaash-dark.webp" width="640" height="640" alt={alt} />
  </picture>;
}
