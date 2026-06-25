// The toast system now lives in components/ui/toast. This module is kept as a
// back-compat shim so non-React callers can keep importing the imperative `toast`.
// React components should prefer the `useToast()` hook from components/ui/toast.
export { toast } from "../components/ui/toast";
export type { ToastKind } from "../components/ui/toast";
