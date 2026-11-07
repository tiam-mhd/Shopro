import { useRef, type CSSProperties } from "react";
import { OTP_CODE_LENGTH } from "@shopro/contracts";

export { OTP_CODE_LENGTH };

type OtpCodeInputProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  length?: number;
  autoFocus?: boolean;
  disabled?: boolean;
};

function normalizeCode(value: string, length: number) {
  return value
    .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)))
    .replace(/\D/g, "")
    .slice(0, length);
}

export function OtpCodeInput({ id, label, value, onChange, length = OTP_CODE_LENGTH, autoFocus, disabled }: OtpCodeInputProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const safeLength = Math.max(1, Math.floor(length));
  const activeIndex = Math.min(value.length, safeLength - 1);

  return <div className="otp-code-control" style={{ "--otp-code-length": safeLength } as CSSProperties}>
    <div className="otp-code-slots" aria-hidden="true">
      {Array.from({ length: safeLength }, (_, index) => <span className={"otp-code-slot" + (index === activeIndex ? " is-active" : "")} key={index}>{value[index] ?? ""}</span>)}
    </div>
    <input
      ref={inputRef}
      className="otp-code-native"
      id={id}
      type="text"
      dir="ltr"
      inputMode="numeric"
      autoComplete="one-time-code"
      autoCapitalize="off"
      spellCheck={false}
      aria-label={label}
      maxLength={safeLength * 3}
      value={value}
      autoFocus={autoFocus}
      disabled={disabled}
      onChange={(event) => onChange(normalizeCode(event.target.value, safeLength))}
      onFocus={(event) => event.currentTarget.setSelectionRange(value.length, value.length)}
      onClick={(event) => event.currentTarget.setSelectionRange(value.length, value.length)}
    />
  </div>;
}
