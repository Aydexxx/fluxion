import { useEffect } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { WorkspaceRole } from "../../lib/types";
import { EASE } from "../../lib/motion";
import { CloseIcon, SettingsIcon } from "../icons";
import {
  PRIMARY_TABS,
  WORKSPACE_NAV,
  visibleSettings,
  type ActiveSection,
  type SettingsKey,
} from "./nav";

interface Props {
  open: boolean;
  role: WorkspaceRole | undefined;
  active: ActiveSection;
  openSettings: SettingsKey | null;
  onClose: () => void;
  onNavigate: (path: string) => void;
  onOpenSettings: (key: SettingsKey) => void;
}

/**
 * The phone presentation of the side panel: a slide-in drawer holding the same
 * navigation (primary + Workspace) and Settings groups as the desktop rail, with
 * full labels. Closes on backdrop tap, Escape, or selecting an item.
 */
export function MobileNavDrawer({
  open,
  role,
  active,
  openSettings,
  onClose,
  onNavigate,
  onOpenSettings,
}: Props) {
  const reduce = useReducedMotion();
  const settings = visibleSettings(role);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
            onClick={onClose}
            className="absolute inset-0 bg-void/70 backdrop-blur-sm"
          />
          <motion.aside
            data-testid="mobile-nav-drawer"
            initial={reduce ? { opacity: 0 } : { x: "-100%" }}
            animate={reduce ? { opacity: 1 } : { x: 0 }}
            exit={reduce ? { opacity: 0 } : { x: "-100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="absolute inset-y-0 left-0 flex w-[80%] max-w-[300px] flex-col border-r border-white/10 bg-base/95 backdrop-blur-xl"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/8 px-4">
              <span className="font-display text-[14px] font-semibold tracking-tight">Menu</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close menu"
                className="flex size-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-ink"
              >
                <CloseIcon className="text-[16px]" />
              </button>
            </div>

            <nav aria-label="Mobile navigation" className="flex-1 space-y-1 overflow-y-auto p-2.5">
              <Group label="Navigate" />
              {[...PRIMARY_TABS, ...WORKSPACE_NAV].map((item) => (
                <Item
                  key={item.key}
                  icon={<item.icon className="text-[17px]" />}
                  label={item.label}
                  active={active === item.key}
                  onClick={() => onNavigate(item.path)}
                />
              ))}

              {settings.length > 0 ? (
                <>
                  <Group label="Settings" icon={<SettingsIcon className="text-[13px]" />} />
                  {settings.map((item) => (
                    <Item
                      key={item.key}
                      icon={<item.icon className="text-[17px]" />}
                      label={item.label}
                      active={active === item.key || openSettings === item.key}
                      onClick={() => onOpenSettings(item.key)}
                    />
                  ))}
                </>
              ) : null}
            </nav>
          </motion.aside>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function Group({ label, icon }: { label: string; icon?: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
      {icon}
      {label}
    </p>
  );
}

function Item({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2.5 text-[14px] font-medium transition-colors"
      style={{
        color: active ? "var(--color-ink)" : "var(--color-muted)",
        background: active ? "color-mix(in oklab, white 7%, transparent)" : "transparent",
      }}
    >
      <span className="flex size-[20px] shrink-0 items-center justify-center">{icon}</span>
      {label}
    </button>
  );
}
