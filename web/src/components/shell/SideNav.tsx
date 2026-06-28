import { motion, useReducedMotion } from "framer-motion";
import type { WorkspaceRole } from "../../lib/types";
import { spring } from "../../lib/motion";
import { ChevronRightIcon, SettingsIcon, SidebarIcon } from "../icons";
import {
  WORKSPACE_NAV,
  visibleSettings,
  type ActiveSection,
  type SettingsKey,
  type WorkspaceNavKey,
} from "./nav";

const EXPANDED_WIDTH = 232;
const COLLAPSED_WIDTH = 64;

interface SideNavProps {
  role: WorkspaceRole | undefined;
  active: ActiveSection;
  /** Which settings manager is currently open (highlighted), if any. */
  openSettings: SettingsKey | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onNavigate: (path: string) => void;
  onOpenSettings: (key: SettingsKey) => void;
}

/**
 * The left app-shell rail. Holds the secondary "Workspace" destinations and the
 * consolidated "Settings" group, gated by role. Collapses to an icon-only rail
 * (state owned by the parent so it can persist), animating its width with a
 * calm spring that flattens under prefers-reduced-motion.
 */
export function SideNav({
  role,
  active,
  openSettings,
  collapsed,
  onToggleCollapse,
  onNavigate,
  onOpenSettings,
}: SideNavProps) {
  const reduce = useReducedMotion();
  const settings = visibleSettings(role);

  return (
    <motion.aside
      data-testid="side-nav"
      data-collapsed={collapsed}
      initial={false}
      animate={{ width: collapsed ? COLLAPSED_WIDTH : EXPANDED_WIDTH }}
      transition={reduce ? { duration: 0 } : spring}
      className="relative z-20 hidden shrink-0 flex-col border-r border-white/8 bg-base/40 py-3 backdrop-blur-sm md:flex"
    >
      <nav aria-label="Secondary" className="flex flex-1 flex-col gap-1 overflow-y-auto px-2.5">
        <GroupLabel collapsed={collapsed}>Workspace</GroupLabel>
        {WORKSPACE_NAV.map((item) => (
          <NavButton
            key={item.key}
            icon={<item.icon className="text-[16px]" />}
            label={item.label}
            collapsed={collapsed}
            active={active === (item.key as WorkspaceNavKey)}
            onClick={() => onNavigate(item.path)}
          />
        ))}

        {settings.length > 0 ? (
          <>
            <div className="my-2 h-px shrink-0 bg-white/6" />
            <GroupLabel collapsed={collapsed} icon={<SettingsIcon className="text-[13px]" />}>
              Settings
            </GroupLabel>
            {settings.map((item) => (
              <NavButton
                key={item.key}
                icon={<item.icon className="text-[16px]" />}
                label={item.label}
                collapsed={collapsed}
                active={active === item.key || openSettings === item.key}
                onClick={() => onOpenSettings(item.key)}
              />
            ))}
          </>
        ) : null}
      </nav>

      <div className="mt-1 shrink-0 border-t border-white/6 px-2.5 pt-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-pressed={collapsed}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium text-faint transition-colors hover:bg-white/5 hover:text-ink"
        >
          <span className="flex size-[18px] shrink-0 items-center justify-center">
            <SidebarIcon className="text-[16px]" />
          </span>
          {!collapsed ? (
            <span className="flex flex-1 items-center justify-between">
              Collapse
              <ChevronRightIcon className="rotate-180 text-[13px]" />
            </span>
          ) : null}
        </button>
      </div>
    </motion.aside>
  );
}

function GroupLabel({
  children,
  collapsed,
  icon,
}: {
  children: string;
  collapsed: boolean;
  icon?: React.ReactNode;
}) {
  if (collapsed) {
    // Collapsed: a thin divider stands in for the group heading.
    return <div className="mx-2 my-1 h-px bg-white/6" aria-hidden />;
  }
  return (
    <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
      {icon}
      {children}
    </p>
  );
}

function NavButton({
  icon,
  label,
  collapsed,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  collapsed: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      title={collapsed ? label : undefined}
      className="group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors"
      style={{
        color: active ? "var(--color-ink)" : "var(--color-muted)",
        background: active ? "color-mix(in oklab, white 7%, transparent)" : "transparent",
      }}
    >
      {active ? (
        <span
          aria-hidden
          className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-accent"
        />
      ) : null}
      <span className="flex size-[18px] shrink-0 items-center justify-center transition-colors group-hover:text-ink">
        {icon}
      </span>
      {!collapsed ? <span className="truncate">{label}</span> : null}
    </button>
  );
}
