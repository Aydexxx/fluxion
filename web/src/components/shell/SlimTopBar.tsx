import { useAuth } from "../../store/auth";
import { navigate } from "../../lib/router";
import { WorkspaceSwitcher } from "../WorkspaceSwitcher";
import { NotificationBell } from "../NotificationBell";
import { Logo, MenuIcon } from "../icons";
import { ProfileMenu } from "./ProfileMenu";
import { PRIMARY_TABS, type ActiveSection } from "./nav";

/**
 * The slim, calm top bar: brand, workspace switcher, the two primary section
 * tabs (Workflows / Templates), the notification bell, and the profile menu.
 * Everything secondary lives in the side panel, so this row stays uncrowded.
 * On phones a hamburger opens the side panel as a drawer.
 */
export function SlimTopBar({ active, onMenu }: { active: ActiveSection; onMenu?: () => void }) {
  const workspace = useAuth((s) => s.workspace);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between gap-4 border-b border-white/8 bg-base/70 px-4 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-2.5">
        {onMenu ? (
          <button
            type="button"
            onClick={onMenu}
            aria-label="Open menu"
            className="-ml-1 flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-white/5 hover:text-ink md:hidden"
          >
            <MenuIcon className="text-[18px]" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex shrink-0 items-center gap-2.5"
          aria-label="Home"
        >
          <Logo className="text-[20px] text-accent" />
          <span className="hidden font-display text-[15px] font-semibold tracking-tight sm:inline">Fluxion</span>
        </button>
        {workspace ? (
          <>
            <span className="text-faint">/</span>
            <WorkspaceSwitcher />
          </>
        ) : null}
      </div>

      <nav aria-label="Primary" className="flex items-center gap-1">
        {PRIMARY_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => navigate(tab.path)}
              aria-current={isActive ? "page" : undefined}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors"
              style={{
                color: isActive ? "var(--color-ink)" : "var(--color-muted)",
                background: isActive ? "color-mix(in oklab, white 7%, transparent)" : "transparent",
              }}
            >
              <Icon className="text-[15px]" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex items-center gap-2">
        <NotificationBell />
        <ProfileMenu />
      </div>
    </header>
  );
}
