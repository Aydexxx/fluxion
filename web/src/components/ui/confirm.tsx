/* Co-locates confirm() with its <ConfirmHost> for a single import surface; see the
   matching note in toast.tsx. */
/* eslint-disable react-refresh/only-export-components */
import { useSyncExternalStore, type ReactNode } from "react";
import { Dialog, DialogBody, DialogFooter, DialogTitle } from "./Dialog";
import { Button } from "./Button";

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  id: number;
  resolve: (ok: boolean) => void;
}

interface ConfirmState {
  open: boolean;
  // The request is kept while closing so its text survives the exit animation.
  request: ConfirmRequest | null;
}

// Minimal external store so confirm() can be called imperatively from anywhere.
let state: ConfirmState = { open: false, request: null };
let nextId = 0;
const listeners = new Set<() => void>();

function setState(next: ConfirmState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Promise-based confirmation. Resolves `true` if confirmed, `false` if dismissed.
 *
 *   if (await confirm({ title: "Delete?", destructive: true })) { ... }
 *
 * Requires <ConfirmHost> mounted once near the app root.
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    setState({ open: true, request: { ...options, id: ++nextId, resolve } });
  });
}

function settle(ok: boolean) {
  const req = state.request;
  // Keep `request` so the dialog keeps its text through the close animation.
  setState({ open: false, request: req });
  req?.resolve(ok);
}

/** Singleton host that renders the active confirmation dialog. Mount once at root. */
export function ConfirmHost() {
  const { open, request } = useSyncExternalStore(subscribe, () => state);

  return (
    <Dialog
      open={open}
      onClose={() => settle(false)}
      size="sm"
      role="alertdialog"
      z="z-[100]"
      aria-label={request?.title ?? "Confirm"}
    >
      <DialogBody>
        <DialogTitle className="font-display text-[17px] font-semibold text-ink">{request?.title}</DialogTitle>
        {request?.body ? <div className="mt-2 text-[13.5px] leading-relaxed text-muted">{request.body}</div> : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => settle(false)}>
          {request?.cancelLabel ?? "Cancel"}
        </Button>
        <Button variant={request?.destructive ? "danger" : "primary"} onClick={() => settle(true)}>
          {request?.confirmLabel ?? "Confirm"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
