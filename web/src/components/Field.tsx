import type { ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes, InputHTMLAttributes } from "react";

const inputBase =
  "w-full rounded-lg bg-void/60 px-3 py-2 text-sm text-ink placeholder:text-faint " +
  "border border-white/8 transition-colors duration-200 " +
  "hover:border-white/14 focus:border-accent/70 focus:bg-void/80 focus:outline-none";

export function Label({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.14em] text-muted">
      {children}
    </label>
  );
}

export function FieldShell({ label, hint, children }: { label?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      {label ? <Label>{label}</Label> : null}
      {children}
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-faint">{hint}</p> : null}
    </div>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputBase} ${props.className ?? ""}`} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={`${inputBase} resize-none font-mono text-[13px] leading-relaxed ${props.className ?? ""}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${inputBase} appearance-none bg-[length:14px] bg-[right_0.6rem_center] bg-no-repeat pr-9 ${props.className ?? ""}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='14' height='14' fill='none' stroke='%238d8d99' stroke-width='1.6' stroke-linecap='round' stroke-linejoin='round'><path d='M3 5l4 4 4-4'/></svg>\")",
        ...props.style,
      }}
    />
  );
}
