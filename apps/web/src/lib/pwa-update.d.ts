export function activateWaitingPwaUpdate(options: {
  registration: ServiceWorkerRegistration | null;
  serviceWorker: ServiceWorkerContainer | null;
  updateSW: () => Promise<void>;
  timeoutMs?: number;
}): Promise<void>;
