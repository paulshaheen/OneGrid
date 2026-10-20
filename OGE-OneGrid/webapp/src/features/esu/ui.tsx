import { useEffect, useRef, type ReactNode } from "react";
import { X, Info } from "lucide-react";
export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function NumberInput({
  value,
  onChange,
  min = 0,
  step = "any",
  placeholder,
}: {
  value: number | null;
  onChange: (n: number | null) => void;
  min?: number;
  step?: string;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      min={min}
      step={step}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : Math.max(min, Number(e.target.value)))
      }
    />
  );
}
export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
export function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "success";
}) {
  return (
    <div className={"notice " + tone}>
      <Info size={17} />
      <div>{children}</div>
    </div>
  );
}
export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: string }) {
  return <span className={"badge " + tone}>{children}</span>;
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  onSave,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  onClose: () => void;
  onSave?: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const el = ref.current;
    el?.querySelector<HTMLElement>("input,select,button")?.focus();
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
      if (e.key === "Tab" && el) {
        const all = [
          ...el.querySelectorAll<HTMLElement>("button,input,select,textarea,a[href]"),
        ].filter((x) => !x.hasAttribute("disabled"));
        if (e.shiftKey && document.activeElement === all[0]) {
          e.preventDefault();
          all.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === all.at(-1)) {
          e.preventDefault();
          all[0]?.focus();
        }
      }
    };
    document.addEventListener("keydown", handle);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handle);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        ref={ref}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="icon-button" aria-label="Close editor" onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="drawer-body">{children}</div>
        <footer>
          <button className="button secondary" onClick={onClose}>
            Cancel
          </button>
          {onSave && (
            <button className="button primary" onClick={onSave}>
              Save changes
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">+</div>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
