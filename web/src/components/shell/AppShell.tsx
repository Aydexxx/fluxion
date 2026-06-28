import { useState, type ReactNode } from "react";
import { useAuth } from "../../store/auth";
import { navigate } from "../../lib/router";
import { canDeleteResources, canEdit } from "../../lib/permissions";
import { useIsMobile } from "../../lib/useMediaQuery";
import { CredentialsManager } from "../CredentialsManager";
import { VariablesManager } from "../VariablesManager";
import { ApiKeysManager } from "../ApiKeysManager";
import { AuditLogView } from "../AuditLogView";
import { MembersManager } from "../MembersManager";
import { SlimTopBar } from "./SlimTopBar";
import { SideNav } from "./SideNav";
import { MobileNavDrawer } from "./MobileNavDrawer";
import type { ActiveSection, SettingsKey } from "./nav";

const COLLAPSE_KEY = "fluxion.nav.collapsed";

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * The application shell for every signed-in workspace page: a slim top bar plus
 * a collapsible left rail, with the page content rendered in a single scroll
 * area. Owns the rail's persisted collapse state and the Settings managers,
 * which open as overlays from the rail rather than crowding the top bar.
 */
export function AppShell({ active, children }: { active: ActiveSection; children: ReactNode }) {
  const workspace = useAuth((s) => s.workspace);
  const role = workspace?.role;

  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [openSettings, setOpenSettings] = useState<SettingsKey | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // On phones the rail is replaced by a slide-in drawer; on desktop it's the
  // persistent (collapsible) left rail.
  const isMobile = useIsMobile();

  const openSettingsAndCloseDrawer = (key: SettingsKey) => {
    setOpenSettings(key);
    setMobileNavOpen(false);
  };

  const toggleCollapse = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* persistence is best-effort */
      }
      return next;
    });
  };

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-base">
      <SlimTopBar active={active} onMenu={() => setMobileNavOpen(true)} />

      <div className="flex min-h-0 flex-1">
        {/* Desktop rail (hidden on phones via the component's own `md:flex`). */}
        <SideNav
          role={role}
          active={active}
          openSettings={openSettings}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          onNavigate={navigate}
          onOpenSettings={setOpenSettings}
        />

        {/* Phone drawer. */}
        <MobileNavDrawer
          open={isMobile && mobileNavOpen}
          role={role}
          active={active}
          openSettings={openSettings}
          onClose={() => setMobileNavOpen(false)}
          onNavigate={(path) => {
            navigate(path);
            setMobileNavOpen(false);
          }}
          onOpenSettings={openSettingsAndCloseDrawer}
        />

        <div className="relative min-w-0 flex-1 overflow-y-auto">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[380px] bloom opacity-70" />
          {children}
        </div>
      </div>

      {/* Settings managers — opened from the rail, gated by role on the way in. */}
      <CredentialsManager
        open={openSettings === "credentials"}
        workspaceId={workspace?.id ?? null}
        canEdit={canEdit(role)}
        onClose={() => setOpenSettings(null)}
      />
      <VariablesManager
        open={openSettings === "variables"}
        workspaceId={workspace?.id ?? null}
        canEdit={canEdit(role)}
        canManage={canDeleteResources(role)}
        onClose={() => setOpenSettings(null)}
      />
      {workspace ? (
        <>
          <MembersManager
            open={openSettings === "members"}
            workspace={workspace}
            onClose={() => setOpenSettings(null)}
          />
          <ApiKeysManager
            open={openSettings === "apiKeys"}
            workspace={workspace}
            onClose={() => setOpenSettings(null)}
          />
          <AuditLogView
            open={openSettings === "activity"}
            workspace={workspace}
            onClose={() => setOpenSettings(null)}
          />
        </>
      ) : null}
    </div>
  );
}
