import { createContext, useContext, useId, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { EASE } from "../../lib/motion";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { CloseIcon } from "../icons";

export type DialogSize = "sm" | "md" | "lg";

const SIZE: Record<DialogSize, string> = {
  sm: "sm:max-w-[400px]",
  md: "sm:max-w-[520px]",
  lg: "sm:max-w-[680px]",
};

interface DialogContextValue {
  onClose: () => void;
  titleId: string;
}
const DialogContext = createContext<DialogContextValue | null>(null);

function useDialog(): DialogContextValue {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("Dialog.* must be used inside <Dialog>");
  return ctx;
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  /** Visual width on desktop. On mobile the dialog is always a full-width sheet. */
  size?: DialogSize;
  role?: "dialog" | "alertdialog";
  /** Used when there's no <DialogHeader> with a visible title. */
  "aria-label"?: string;
  closeOnBackdrop?: boolean;
  /** Tailwind z-index utility — bump for overlays that stack above others. */
  z?: string;
  children: ReactNode;
}

/**
 * Cinematic, accessible modal. Backdrop blur, centered on desktop / bottom sheet
 * on mobile, height capped to the viewport with the body scrolling internally so
 * content can never be pushed off-screen. Traps focus, closes on ESC and backdrop
 * click, and respects prefers-reduced-motion.
 *
 * Compose with <DialogHeader>, <DialogBody>, <DialogFooter>. The body is the only
 * scrolling region; header and footer stay pinned.
 */
export function Dialog({
  open,
  onClose,
  size = "md",
  role = "dialog",
  closeOnBackdrop = true,
  z = "z-[90]",
  children,
  ...rest
}: DialogProps) {
  const reduce = useReducedMotion();
  const titleId = useId();
  const trapRef = useFocusTrap<HTMLDivElement>(open, onClose);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className={`fixed inset-0 ${z} flex items-end justify-center sm:items-center sm:p-4`}>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            onClick={closeOnBackdrop ? onClose : undefined}
            className="absolute inset-0 bg-void/70 backdrop-blur-sm"
          />
          <motion.div
            ref={trapRef}
            tabIndex={-1}
            role={role}
            aria-modal="true"
            aria-labelledby={titleId}
            aria-label={rest["aria-label"]}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.28, ease: EASE }}
            className={`relative flex max-h-[92dvh] w-full ${SIZE[size]} flex-col overflow-hidden rounded-t-2xl glass outline-none sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl`}
            style={{ boxShadow: "0 30px 80px -30px rgba(0,0,0,0.85)" }}
          >
            <DialogContext.Provider value={{ onClose, titleId }}>{children}</DialogContext.Provider>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * The dialog's accessible title. Wires the element to the dialog's
 * aria-labelledby. Use inside <DialogHeader> (done for you) or directly in the
 * body for header-less dialogs.
 */
export function DialogTitle({
  children,
  className = "text-[15px] font-semibold text-ink",
}: {
  children: ReactNode;
  className?: string;
}) {
  const { titleId } = useDialog();
  return (
    <h2 id={titleId} className={className}>
      {children}
    </h2>
  );
}

/** Pinned header. Pass an icon chip, title and optional description; renders a close button. */
export function DialogHeader({
  title,
  description,
  icon,
  hideClose = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  hideClose?: boolean;
}) {
  const { onClose } = useDialog();
  return (
    <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/8 p-4">
      <div className="flex min-w-0 items-center gap-2.5">
        {icon ? (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-[16px] text-accent">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <DialogTitle className="truncate text-[15px] font-semibold text-ink">{title}</DialogTitle>
          {description ? <p className="text-[11.5px] text-faint">{description}</p> : null}
        </div>
      </div>
      {hideClose ? null : (
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="shrink-0 rounded-lg p-1.5 text-faint transition-colors hover:bg-white/5 hover:text-ink"
        >
          <CloseIcon />
        </button>
      )}
    </header>
  );
}

/** The single scrolling region. Everything else stays pinned. */
export function DialogBody({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`min-h-0 flex-1 overflow-y-auto p-4 ${className}`}>{children}</div>;
}

/** Pinned footer, typically holding the primary/secondary actions. */
export function DialogFooter({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <footer className={`flex shrink-0 items-center justify-end gap-2 border-t border-white/8 p-4 ${className}`}>
      {children}
    </footer>
  );
}
