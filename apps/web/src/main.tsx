import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { registerSW } from "virtual:pwa-register";
import "@fontsource/vazirmatn/400.css";
import "@fontsource/vazirmatn/500.css";
import "@fontsource/vazirmatn/600.css";
import "@fontsource/vazirmatn/700.css";
import "./styles.css";
import { App } from "./App.js";

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 20_000, retry: (count, error) => count < 1 && !(error instanceof Error && "status" in error && (error as { status: number }).status === 401), refetchOnWindowFocus: false } } });
let updateReady = false;
const updateSW = registerSW({ immediate: true, onNeedRefresh: () => { updateReady = true; window.dispatchEvent(new Event("shopro:pwa-update")); } });

function PwaUpdatePrompt() {
  const [visible, setVisible] = useState(updateReady);
  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener("shopro:pwa-update", show);
    return () => window.removeEventListener("shopro:pwa-update", show);
  }, []);
  if (!visible) return null;
  return <aside className="pwa-update-prompt" role="status" dir="rtl"><span>نسخهٔ تازهٔ شاپرو آماده است.</span><button className="button button-primary" type="button" onClick={() => void updateSW(true)}>به‌روزرسانی</button><button className="button button-text" type="button" aria-label="بعداً" onClick={() => setVisible(false)}>بعداً</button></aside>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}><App /><PwaUpdatePrompt /></QueryClientProvider>
  </React.StrictMode>,
);
