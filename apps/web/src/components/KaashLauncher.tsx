import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { ApiError, post } from "../lib/api.js";
import { KAASH_PLACEHOLDER, kaashCharacterCount, kaashScreenForPath, normalizeKaashText } from "../lib/kaash.js";
import { useLocation } from "react-router-dom";
import { KaashLogo } from "./KaashLogo.js";

type PendingSubmission = { id: string; content: string; screenKey: string };

export function KaashLauncher({ online }: { online: boolean }) {
  const { pathname } = useLocation();
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [pendingSubmission, setPendingSubmission] = useState<PendingSubmission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  const screenKey = kaashScreenForPath(pathname);
  const characterCount = kaashCharacterCount(content);
  const normalizedContent = normalizeKaashText(content);

  useEffect(() => {
    const updateTarget = () => {
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]'))
        .filter((element) => !element.closest(".kaash-modal") && element.getClientRects().length > 0);
      setPortalTarget(dialogs.at(-1) ?? document.body);
    };
    updateTarget();
    const observer = new MutationObserver(updateTarget);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-modal", "style"] });
    return () => observer.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const root = document.getElementById("root") as (HTMLElement & { inert: boolean }) | null;
    const wasInert = root?.inert ?? false;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    if (root) root.inert = true;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => textareaRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (root) root.inert = wasInert;
      document.body.style.overflow = previousOverflow;
      window.setTimeout(() => {
        const trigger = launcherRef.current?.isConnected ? launcherRef.current : previousFocus;
        if (trigger?.isConnected && !(trigger instanceof HTMLButtonElement && trigger.disabled)) trigger.focus();
      }, 0);
    };
  }, [open]);

  const closeDialog = () => {
    setOpen(false);
    window.setTimeout(() => {
      const trigger = launcherRef.current;
      if (trigger?.isConnected && !trigger.disabled) trigger.focus();
    }, 0);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sendingRef.current || busy || !online) return;
    if (!normalizedContent || characterCount > 1000) return;
    const exactScreenKey = pendingSubmission?.content === normalizedContent ? pendingSubmission.screenKey : screenKey;
    const submission = pendingSubmission?.content === normalizedContent
      ? pendingSubmission
      : { id: crypto.randomUUID(), content: normalizedContent, screenKey: exactScreenKey };
    sendingRef.current = true;
    setPendingSubmission(submission);
    setBusy(true);
    setError("");
    setSuccess(false);
    try {
      await post("/kaash", { content: normalizedContent, screenKey: submission.screenKey, clientSubmissionId: submission.id }, { "Idempotency-Key": submission.id });
      setContent("");
      setPendingSubmission(null);
      setSuccess(true);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "ارسال انجام نشد. اتصال را بررسی کنید و دوباره تلاش کنید.");
    } finally {
      sendingRef.current = false;
      setBusy(false);
    }
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button:not([disabled]), textarea:not([disabled])"));
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  };

  if (!portalTarget) return null;
  return <>
    {createPortal(<button
      ref={launcherRef}
      type="button"
      className={`kaash-launcher ${open ? "is-hidden" : ""}`}
      aria-label="ثبت کاش برای بهترشدن شاپرو"
      title="ثبت کاش"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-hidden={open}
      tabIndex={open ? -1 : 0}
      disabled={open}
      onClick={() => setOpen(true)}
    ><KaashLogo alt="" /></button>, portalTarget)}
    {open && createPortal(<div className="kaash-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDialog(); }}>
      <section className="kaash-modal" role="dialog" aria-modal="true" aria-labelledby="kaash-modal-title" dir="rtl" onKeyDown={onDialogKeyDown}>
        <header className="kaash-modal-heading"><div><KaashLogo alt="" /><div><span className="eyebrow">صدای شما برای شاپرو</span><h2 id="kaash-modal-title">یک کاش برای بهترشدن</h2></div></div><button className="icon-button" type="button" aria-label="بستن پنجرهٔ کاش" onClick={closeDialog}><X size={20} /></button></header>
        <form onSubmit={(event) => void submit(event)}>
          <textarea ref={textareaRef} aria-label="متن پیشنهاد شما" dir="rtl" value={content} onChange={(event) => { setContent(event.target.value); setError(""); setSuccess(false); }} placeholder={KAASH_PLACEHOLDER} maxLength={4000} rows={5} />
          <div className="kaash-modal-meta"><span aria-live="polite">{success ? "سپاس، کاش شما با موفقیت ثبت شد." : ""}</span><span className="kaash-character-count">{characterCount.toLocaleString("fa-IR")} / ۱٬۰۰۰</span></div>
          {error && <p className="kaash-form-error" role="alert">{error}</p>}
          {!online && <p className="kaash-offline-note" role="status">پس از اتصال دوباره، «ثبت کاش» را بزنید تا پاسخ سرور دریافت شود.</p>}
          <button className="button button-primary full kaash-submit" type="submit" disabled={!online || busy || !normalizedContent || characterCount > 1000} aria-busy={busy}>{busy ? "در حال ثبت…" : "ثبت کاش"}</button>
        </form>
      </section>
    </div>, document.body)}
  </>;
}
