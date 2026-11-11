const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealItems = Array.from(document.querySelectorAll("[data-reveal]"));

if (!reduceMotion && "IntersectionObserver" in window) {
  document.documentElement.classList.add("motion-ready");
  const revealObserver = new IntersectionObserver((entries, observer) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }
  }, { rootMargin: "0px 0px -48px 0px", threshold: 0.12 });

  for (const item of revealItems) revealObserver.observe(item);
}

const mobileMenu = document.querySelector(".mobile-nav");
if (mobileMenu) {
  for (const link of mobileMenu.querySelectorAll("a")) {
    link.addEventListener("click", () => mobileMenu.removeAttribute("open"));
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && mobileMenu.open) {
      mobileMenu.removeAttribute("open");
      mobileMenu.querySelector("summary")?.focus();
    }
  });

  document.addEventListener("pointerdown", (event) => {
    if (mobileMenu.open && !mobileMenu.contains(event.target)) mobileMenu.removeAttribute("open");
  });
}

const anchorLinks = Array.from(document.querySelectorAll('.desktop-nav a[href^="#"], .mobile-nav a[href^="#"]'));
const sections = anchorLinks
  .map((link) => document.querySelector(link.getAttribute("href")))
  .filter(Boolean);

if ("IntersectionObserver" in window && sections.length) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;

    for (const link of anchorLinks) {
      if (link.getAttribute("href") !== "#" + visible.target.id) link.removeAttribute("aria-current");
      else link.setAttribute("aria-current", "location");
    }
  }, { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.15, 0.3, 0.5] });

  for (const section of sections) sectionObserver.observe(section);
}
