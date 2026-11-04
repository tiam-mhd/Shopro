const DEFAULT_CONTROLLER_TIMEOUT_MS = 15_000;

export async function activateWaitingPwaUpdate({ registration, serviceWorker, updateSW, timeoutMs = DEFAULT_CONTROLLER_TIMEOUT_MS }) {
  if (!serviceWorker) {
    throw new Error("این مرورگر امکان به‌روزرسانی برنامه را ندارد. صفحه را دوباره بارگذاری کنید.");
  }

  const activeRegistration = registration ?? await serviceWorker.getRegistration();
  if (!activeRegistration) {
    throw new Error("ثبت نسخهٔ آفلاین برنامه پیدا نشد. صفحه را دوباره بارگذاری کنید.");
  }
  if (!activeRegistration.waiting) {
    throw new Error("نسخهٔ تازه دیگر آمادهٔ نصب نیست. صفحه را دوباره بارگذاری کنید.");
  }

  let timeout;
  let controllerChangeHandler;
  const controllerChanged = new Promise((resolve, reject) => {
    controllerChangeHandler = () => resolve();
    serviceWorker.addEventListener("controllerchange", controllerChangeHandler, { once: true });
    timeout = setTimeout(() => reject(new Error("نسخهٔ تازه فعال نشد. اتصال را بررسی کنید یا صفحه را دوباره بارگذاری کنید.")), timeoutMs);
  });
  const controllerOutcome = controllerChanged.then(
    () => ({ ok: true }),
    (error) => ({ ok: false, error }),
  );

  try {
    await updateSW();
    const result = await controllerOutcome;
    if (!result.ok) throw result.error;
  } finally {
    clearTimeout(timeout);
    if (controllerChangeHandler) serviceWorker.removeEventListener("controllerchange", controllerChangeHandler);
  }
}
