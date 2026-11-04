import test from "node:test";
import assert from "node:assert/strict";
import { activateWaitingPwaUpdate } from "../src/lib/pwa-update.js";

function makeServiceWorker(registration) {
  const serviceWorker = new EventTarget();
  serviceWorker.getRegistration = async () => registration;
  return serviceWorker;
}

test("a waiting service worker activates and the page waits for controllerchange", async () => {
  const registration = { waiting: {} };
  const serviceWorker = makeServiceWorker(registration);
  let requested = false;
  await activateWaitingPwaUpdate({
    registration,
    serviceWorker,
    updateSW: async () => {
      requested = true;
      setImmediate(() => serviceWorker.dispatchEvent(new Event("controllerchange")));
    },
    timeoutMs: 100,
  });
  assert.equal(requested, true);
});

test("a stale update prompt returns a recoverable message instead of silently doing nothing", async () => {
  const serviceWorker = makeServiceWorker({ waiting: null });
  await assert.rejects(
    activateWaitingPwaUpdate({ registration: { waiting: null }, serviceWorker, updateSW: async () => {}, timeoutMs: 100 }),
    /نسخهٔ تازه دیگر آمادهٔ نصب نیست/,
  );
});

test("a worker that does not take control times out with a recoverable error", async () => {
  const serviceWorker = makeServiceWorker({ waiting: {} });
  await assert.rejects(
    activateWaitingPwaUpdate({ registration: { waiting: {} }, serviceWorker, updateSW: async () => {}, timeoutMs: 5 }),
    /نسخهٔ تازه فعال نشد/,
  );
});

test("worker activation failures remove listeners and surface the original cause", async () => {
  const serviceWorker = makeServiceWorker({ waiting: {} });
  await assert.rejects(
    activateWaitingPwaUpdate({ registration: { waiting: {} }, serviceWorker, updateSW: async () => { throw new Error("postMessage failed"); }, timeoutMs: 100 }),
    /postMessage failed/,
  );
});
