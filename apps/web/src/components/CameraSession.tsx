import { useCallback, useEffect, useState, type RefObject } from "react";

type NumericRange = { min: number; max: number; step?: number };
type CameraCapabilities = {
  deviceId?: string;
  focusMode?: string[];
  focusDistance?: NumericRange;
  torch?: boolean;
  zoom?: NumericRange;
  exposureCompensation?: NumericRange;
};
type CameraSettings = { deviceId?: string; focusMode?: string; focusDistance?: number; torch?: boolean; zoom?: number; exposureCompensation?: number };
type CameraConstraint = { focusMode?: string; focusDistance?: number; torch?: boolean; zoom?: number; exposureCompensation?: number };

export function useCameraSession(videoRef: RefObject<HTMLVideoElement | null>, active: boolean) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [activeDeviceId, setActiveDeviceId] = useState("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [capabilities, setCapabilities] = useState<CameraCapabilities>({});
  const [focusMode, setFocusMode] = useState("");
  const [focusDistance, setFocusDistance] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [torch, setTorch] = useState(false);
  const [exposureCompensation, setExposureCompensation] = useState(0);
  const [controlError, setControlError] = useState("");
  const [status, setStatus] = useState("در حال آماده‌سازی دوربین…");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let localStream: MediaStream | null = null;
    let localTrack: MediaStreamTrack | null = null;
    setError(""); setControlError(""); setReady(false); setStatus("در حال آماده‌سازی دوربین…");
    setDevices([]); setCapabilities({}); setTrack(null); setStream(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("برای استفاده از دوربین، صفحه باید در اتصال امن باز شده باشد.");
      return;
    }

    const start = async () => {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { ...(selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : { facingMode: { ideal: facingMode } }), width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        if (cancelled) { localStream.getTracks().forEach((item) => item.stop()); return; }
        localTrack = localStream.getVideoTracks()[0] ?? null;
        const video = videoRef.current;
        if (!localTrack || !video) throw new Error("پیش‌نمایش دوربین آماده نشد.");
        video.srcObject = localStream;
        await video.play();
        if (cancelled) { localStream.getTracks().forEach((item) => item.stop()); return; }
        const caps = readCapabilities(localTrack);
        const settings = readSettings(localTrack);
        const supportedFocus = caps.focusMode ?? [];
        const preferredFocus = supportedFocus.includes("continuous") ? "continuous" : supportedFocus.includes("single-shot") ? "single-shot" : supportedFocus.includes("manual") ? "manual" : supportedFocus[0] ?? "";
        if (preferredFocus) {
          try { await applyCameraConstraints(localTrack, { focusMode: preferredFocus }); } catch { /* Keep the camera's native focus behavior if a mode cannot be applied. */ }
        }
        let availableDevices: MediaDeviceInfo[] = [];
        try { availableDevices = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "videoinput"); } catch { /* Camera preview still works when device labels are unavailable. */ }
        if (cancelled) return;
        setStream(localStream); setTrack(localTrack); setCapabilities(caps); setDevices(availableDevices); setReady(true); setStatus("دوربین آماده است؛ تنظیمات پشتیبانی‌شده را می‌توانید تغییر دهید.");
        setActiveDeviceId(settings.deviceId ?? localTrack.getSettings().deviceId ?? "");
        setFocusMode(preferredFocus || settings.focusMode || "");
        setFocusDistance(settings.focusDistance ?? caps.focusDistance?.min ?? 0);
        setZoom(settings.zoom ?? caps.zoom?.min ?? 1);
        setTorch(settings.torch ?? false);
        setExposureCompensation(settings.exposureCompensation ?? 0);
      } catch (cause) {
        if (cancelled) return;
        localStream?.getTracks().forEach((item) => item.stop());
        if (videoRef.current?.srcObject === localStream) videoRef.current.srcObject = null;
        const name = cause instanceof DOMException ? cause.name : "";
        setError(name === "NotAllowedError" ? "اجازهٔ دسترسی به دوربین داده نشد. مجوز دوربین را در مرورگر فعال کنید." : name === "NotFoundError" ? "دوربینی روی این دستگاه پیدا نشد." : name === "NotReadableError" ? "دوربین در برنامهٔ دیگری در حال استفاده است." : "دوربین باز نشد. مجوز دسترسی و اتصال امن صفحه را بررسی کنید.");
        setStatus("");
      }
    };
    void start();
    return () => {
      cancelled = true;
      localStream?.getTracks().forEach((item) => item.stop());
      if (videoRef.current?.srcObject === localStream) videoRef.current.srcObject = null;
      setReady(false); setTrack(null); setStream(null); setActiveDeviceId(""); setCapabilities({});
    };
  }, [active, facingMode, selectedDeviceId, videoRef]);

  const apply = useCallback(async (constraint: CameraConstraint) => {
    if (!track) return false;
    try {
      await applyCameraConstraints(track, constraint);
      setControlError("");
      return true;
    } catch {
      setControlError("این دوربین یا مرورگر این تنظیم را اعمال نکرد. حالت دیگری انتخاب کنید.");
      return false;
    }
  }, [track]);

  const changeFocusMode = useCallback(async (value: string) => {
    if (await apply({ focusMode: value })) setFocusMode(value);
  }, [apply]);
  const changeFocusDistance = useCallback(async (value: number) => {
    if (await apply({ focusMode: "manual", focusDistance: value })) { setFocusMode("manual"); setFocusDistance(value); }
  }, [apply]);
  const changeZoom = useCallback(async (value: number) => { if (await apply({ zoom: value })) setZoom(value); }, [apply]);
  const changeExposure = useCallback(async (value: number) => { if (await apply({ exposureCompensation: value })) setExposureCompensation(value); }, [apply]);
  const changeTorch = useCallback(async (value: boolean) => { if (await apply({ torch: value })) setTorch(value); }, [apply]);
  const switchCamera = useCallback(() => { setSelectedDeviceId(""); setFacingMode((value) => value === "environment" ? "user" : "environment"); }, []);

  return { stream, track, ready, error, status, devices, selectedDeviceId, activeDeviceId, setSelectedDeviceId, switchCamera, capabilities, focusMode, focusDistance, zoom, torch, exposureCompensation, controlError, changeFocusMode, changeFocusDistance, changeZoom, changeExposure, changeTorch };
}

export type CameraSession = ReturnType<typeof useCameraSession>;

export function CameraControls({ camera }: { camera: CameraSession }) {
  const { capabilities, devices } = camera;
  const hasControls = Boolean((capabilities.focusMode?.length ?? 0) || capabilities.focusDistance || capabilities.zoom || capabilities.torch || capabilities.exposureCompensation || devices.length > 1);
  return <div className="camera-control-panel">
    {devices.length > 1 && <label className="camera-control camera-device-control"><span>دوربین</span><select value={camera.selectedDeviceId || camera.activeDeviceId} onChange={(event) => camera.setSelectedDeviceId(event.target.value)} aria-label="انتخاب دوربین">{devices.map((device, index) => <option value={device.deviceId} key={device.deviceId}>{device.label || `دوربین ${index + 1}`}</option>)}</select><button className="button button-secondary" type="button" onClick={camera.switchCamera}>تغییر دوربین</button></label>}
    {capabilities.focusMode?.length ? <label className="camera-control"><span>فوکوس</span><select value={camera.focusMode} onChange={(event) => void camera.changeFocusMode(event.target.value)} aria-label="حالت فوکوس">{capabilities.focusMode.map((mode) => <option key={mode} value={mode}>{focusLabel(mode)}</option>)}</select></label> : capabilities.focusDistance ? <button className="button button-secondary" type="button" onClick={() => void camera.changeFocusMode("manual")}>تنظیم فوکوس دستی</button> : <span className="camera-control-static">فوکوس خودکار دستگاه</span>}
    {capabilities.focusDistance && camera.focusMode === "manual" && <RangeControl label="فاصلهٔ فوکوس" range={capabilities.focusDistance} value={camera.focusDistance} onChange={camera.changeFocusDistance} />}
    {capabilities.zoom && <RangeControl label="بزرگ‌نمایی" range={capabilities.zoom} value={camera.zoom} onChange={camera.changeZoom} />}
    {capabilities.exposureCompensation && <RangeControl label="نوردهی" range={capabilities.exposureCompensation} value={camera.exposureCompensation} onChange={camera.changeExposure} />}
    {capabilities.torch && <label className="camera-control camera-toggle"><input type="checkbox" checked={camera.torch} onChange={(event) => void camera.changeTorch(event.target.checked)} /><span>چراغ دوربین</span></label>}
    {!hasControls && <span className="camera-control-static">تنظیم فوکوس و نور در این دستگاه خودکار است.</span>}
    {camera.controlError && <span className="camera-control-error" role="status">{camera.controlError}</span>}
  </div>;
}

function RangeControl({ label, range, value, onChange }: { label: string; range: NumericRange; value: number; onChange: (value: number) => void }) {
  const step = range.step && range.step > 0 ? range.step : 0.01;
  return <label className="camera-control camera-range-control"><span>{label}</span><input type="range" dir="ltr" min={range.min} max={range.max} step={step} value={clamp(value, range.min, range.max)} onChange={(event) => void onChange(Number(event.target.value))} aria-label={label} /><small dir="ltr">{Number(value.toFixed(2))}</small></label>;
}

function readCapabilities(track: MediaStreamTrack): CameraCapabilities {
  try { return (track as MediaStreamTrack & { getCapabilities?: () => CameraCapabilities }).getCapabilities?.() ?? {}; } catch { return {}; }
}
function readSettings(track: MediaStreamTrack): CameraSettings {
  try { return (track.getSettings() as CameraSettings) ?? {}; } catch { return {}; }
}
async function applyCameraConstraints(track: MediaStreamTrack, constraint: CameraConstraint) {
  const advanced = [constraint as unknown as MediaTrackConstraintSet];
  await track.applyConstraints({ advanced });
}
function focusLabel(mode: string) { return ({ manual: "دستی", continuous: "خودکار پیوسته", "single-shot": "فوکوس لحظه‌ای", none: "بدون فوکوس" })[mode] ?? mode; }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
