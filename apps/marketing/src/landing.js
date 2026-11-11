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
  }, { rootMargin: "0px 0px -52px 0px", threshold: 0.12 });

  revealItems.forEach((item, index) => {
    if (!item.matches(".daily-card, .possibility-card")) {
      const group = item.closest("section")?.querySelectorAll("[data-reveal]") ?? [];
      const position = Array.from(group).indexOf(item);
      item.style.setProperty("--reveal-delay", `${Math.min(position, 3) * 85}ms`);
    }
    revealObserver.observe(item);
  });
}

const mobileMenu = document.querySelector(".mobile-nav");
if (mobileMenu) {
  for (const link of mobileMenu.querySelectorAll("a")) {
    link.addEventListener("click", () => mobileMenu.removeAttribute("open"));
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !mobileMenu.open) return;
    mobileMenu.removeAttribute("open");
    mobileMenu.querySelector("summary")?.focus();
  });

  document.addEventListener("pointerdown", (event) => {
    if (mobileMenu.open && !mobileMenu.contains(event.target)) mobileMenu.removeAttribute("open");
  });
}

const anchorLinks = Array.from(document.querySelectorAll('.desktop-nav a[href^="#"], .mobile-nav a[href^="#"]'));
const sections = anchorLinks.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);

if ("IntersectionObserver" in window && sections.length) {
  const sectionObserver = new IntersectionObserver((entries) => {
    const visible = entries
      .filter((entry) => entry.isIntersecting)
      .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;

    for (const link of anchorLinks) {
      if (link.getAttribute("href") === `#${visible.target.id}`) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    }
  }, { rootMargin: "-17% 0px -63% 0px", threshold: [0, 0.16, 0.32, 0.5] });

  sections.forEach((section) => sectionObserver.observe(section));
}

if (!reduceMotion) {
  const floaters = Array.from(document.querySelectorAll("[data-scroll-float]"));
  const progressTrack = document.querySelector(".daily-section .day-path");
  let pendingFrame = false;

  const updateScrollMotion = () => {
    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    const progress = Math.min(1, Math.max(0, window.scrollY / maxScroll));
    document.documentElement.style.setProperty("--page-progress", progress.toFixed(4));

    floaters.forEach((item, index) => {
      const speed = Number(item.dataset.scrollFloat) || 0;
      const phase = progress * 6.2 + index * 1.38;
      const drift = Math.sin(phase) * 24 + Math.sin(progress * 2.4 + index) * 9 + speed * progress * 30;
      const tilt = Math.cos(phase * .75) * 7 + speed * 18;
      item.style.setProperty("--scroll-drift", `${drift.toFixed(1)}px`);
      item.style.setProperty("--scroll-tilt", `${tilt.toFixed(1)}deg`);
    });

    if (progressTrack) {
      const rect = progressTrack.getBoundingClientRect();
      const travel = rect.height + window.innerHeight;
      const sectionProgress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / travel));
      progressTrack.style.setProperty("--daily-progress", `${Math.round(sectionProgress * 100)}%`);
    }
    pendingFrame = false;
  };

  const requestScrollMotion = () => {
    if (pendingFrame) return;
    pendingFrame = true;
    window.requestAnimationFrame(updateScrollMotion);
  };

  window.addEventListener("scroll", requestScrollMotion, { passive: true });
  window.addEventListener("resize", requestScrollMotion, { passive: true });
  updateScrollMotion();
}
