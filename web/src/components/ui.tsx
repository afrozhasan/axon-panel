import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

type Tone = "ok" | "warn" | "bad" | "neutral" | "info";

const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
  warn: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25",
  bad: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25",
  neutral: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/25",
  info: "bg-[var(--axon-primary)]/10 text-[var(--axon-primary)] border-[var(--axon-primary)]/25",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  bodyClassName = "p-4 sm:p-5",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-3 border-b border-[var(--axon-border)] px-4 sm:px-5 py-3.5">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-[var(--axon-text)]">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-xs text-[var(--axon-muted)]">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
  loading?: boolean;
};

export function Button({ variant = "ghost", loading = false, disabled, children, className = "", ...rest }: ButtonProps) {
  const variantClass = variant === "primary" ? "btn-primary" : variant === "danger" ? "btn-danger" : "btn-ghost";
  return (
    <button className={`btn ${variantClass} ${className}`} disabled={disabled || loading} {...rest}>
      {loading && <Spinner className="h-3 w-3" />}
      {children}
    </button>
  );
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--axon-text)]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-[var(--axon-muted)]">{hint}</span>}
    </label>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="mb-3 whitespace-pre-wrap rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
      {message}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  width = "max-w-lg",
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center sm:items-start justify-center overflow-y-auto bg-black/70 backdrop-blur-xs p-3 sm:p-6 sm:pt-14">
      <div className={`w-full ${width} rounded-xl sm:rounded-2xl border border-[var(--axon-border)] bg-[var(--axon-card)] shadow-2xl overflow-hidden max-h-[92vh] flex flex-col`}>
        <header className="flex items-center justify-between border-b border-[var(--axon-border)] px-4 sm:px-5 py-3.5 shrink-0">
          <h3 className="text-sm font-semibold text-[var(--axon-text)]">{title}</h3>
          <button
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--axon-muted)] hover:text-[var(--axon-text)] hover:bg-[var(--axon-card-hover)] transition"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </header>
        <div className="overflow-y-auto p-4 sm:p-5 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  requireText,
  confirmLabel = "Delete",
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  requireText?: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (typed: string) => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const ready = !requireText || typed === requireText;

  return (
    <Modal open={open} title={title} onClose={onCancel} width="max-w-md">
      <div className="space-y-3 text-sm text-[var(--axon-text)]">
        <div className="whitespace-pre-wrap">{message}</div>
        {requireText && (
          <div>
            <p className="mb-1 text-xs text-[var(--axon-muted)]">
              Type <span className="mono text-amber-400 font-bold">{requireText}</span> to confirm:
            </p>
            <input className="field mono" value={typed} onChange={(event) => setTyped(event.target.value)} autoFocus />
          </div>
        )}
      </div>
      <footer className="mt-4 flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="danger" disabled={!ready} loading={busy} onClick={() => onConfirm(typed)}>
          {confirmLabel}
        </Button>
      </footer>
    </Modal>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
  wrap = true,
}: {
  tabs: { id: string; label: string; badge?: ReactNode }[];
  active: string;
  onChange: (id: string) => void;
  wrap?: boolean;
}) {
  return (
    <div
      className={
        wrap
          ? "flex flex-wrap items-center gap-1.5 border-b border-[var(--axon-border)] pb-2.5"
          : "flex items-center gap-1.5 border-b border-[var(--axon-border)] overflow-x-auto pb-2.5"
      }
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 ${
              isActive
                ? "bg-[var(--axon-primary)] text-[var(--axon-primary-fg)] font-semibold shadow-xs"
                : "bg-[var(--axon-card)] border border-[var(--axon-border)] text-[var(--axon-muted)] hover:text-[var(--axon-text)] hover:border-[var(--axon-muted)] hover:bg-[var(--axon-card-hover)]"
            }`}
          >
            <span>{tab.label}</span>
            {tab.badge !== undefined && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] font-mono leading-none border ${
                  isActive
                    ? "bg-white/20 text-white border-white/20 font-semibold"
                    : "bg-[var(--axon-input-bg)] text-[var(--axon-muted)] border-[var(--axon-border)]"
                }`}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return <div className="py-8 text-center text-sm text-[var(--axon-muted)]">{message}</div>;
}

export function ProgressBar({ percent, tone = "info" }: { percent: number; tone?: Tone }) {
  const colors: Record<Tone, string> = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-rose-500",
    neutral: "bg-slate-500",
    info: "bg-[var(--axon-primary)]",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--axon-border)]">
      <div className={`h-full rounded-full transition-all duration-300 ${colors[tone]}`} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
    </div>
  );
}

type Toast = { id: number; tone: "ok" | "error" | "info"; message: string };

const ToastContext = createContext<(tone: Toast["tone"], message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: Toast["tone"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 6000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`whitespace-pre-wrap rounded-lg border px-3 py-2 text-xs shadow-lg ${
              toast.tone === "ok"
                ? "border-emerald-500/40 bg-emerald-950/90 text-emerald-100"
                : toast.tone === "error"
                  ? "border-rose-500/40 bg-rose-950/90 text-rose-100"
                  : "border-[var(--axon-border)] bg-[var(--axon-card)] text-[var(--axon-text)]"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useAsyncAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const run = useCallback(
    async (fn: () => Promise<void>, successMessage?: string) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        if (successMessage) toast("ok", successMessage);
        return true;
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message);
        toast("error", message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  return { busy, error, run, setError };
}
