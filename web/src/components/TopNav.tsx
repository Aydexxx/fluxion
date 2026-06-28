import { useState } from "react";
import { useAuth } from "../store/auth";
import { navigate, useRoute } from "../lib/router";
import { canDeleteResources, canEdit, canManageMembers } from "../lib/permissions";
import { CredentialsManager } from "./CredentialsManager";
import { VariablesManager } from "./VariablesManager";
import { ApiKeysManager } from "./ApiKeysManager";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { NotificationBell } from "./NotificationBell";
import { AuditLogView } from "./AuditLogView";
import { BracesIcon, ChartIcon, GridIcon, HistoryIcon, KeyIcon, Logo, LogoutIcon, SparkIcon, TerminalIcon } from "./icons";

type NavKey = "workflows" | "templates" | "runs" | "analytics";

const TABS: { key: NavKey; label: string; path: string; icon: typeof GridIcon }[] = [
  { key: "workflows", label: "Workflows", path: "/", icon: GridIcon },
  { key: "templates", label: "Templates", path: "/templates", icon: SparkIcon },
  { key: "runs", label: "Runs", path: "/runs", icon: HistoryIcon },
  { key: "analytics", label: "Analytics", path: "/analytics", icon: ChartIcon },
];

/** Shared top bar across the workspace pages: brand, primary nav, credentials, sign-out. */
export function TopNav({ active }: { active: NavKey }) {
  const user = useAuth((s) => s.user);
  const workspace = useAuth((s) => s.workspace);
  const logout = useAuth((s) => s.logout);
  const route = useRoute();
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [variablesOpen, setVariablesOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [apiKeysOpen, setApiKeysOpen] = useState(false);

  // `route` is read so the nav re-renders on navigation (active state stays in sync).
  void route;

  return (
    <header className="sticky top-0 z-30 border-b border-white/8 bg-base/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => navigate("/")} className="flex items-center gap-2.5" aria-label="Home">
            <Logo className="text-[20px] text-accent" />
            <span className="font-display text-[15px] font-semibold tracking-tight">Fluxion</span>
          </button>
          {workspace ? (
            <>
              <span className="mx-1 text-faint">/</span>
              <WorkspaceSwitcher />
            </>
          ) : null}
        </div>

        <nav className="hidden items-center gap-1 sm:flex">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = tab.key === active;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => navigate(tab.path)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors"
                style={{
                  color: isActive ? "var(--color-ink)" : "var(--color-muted)",
                  background: isActive ? "color-mix(in oklab, white 7%, transparent)" : "transparent",
                }}
              >
                <Icon className="text-[15px]" /> {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <span className="hidden text-[13px] text-muted md:block">{user?.name}</span>
          <NotificationBell />
          {workspace && canManageMembers(workspace.role) ? (
            <>
              <button
                type="button"
                onClick={() => setApiKeysOpen(true)}
                aria-label="API keys"
                className="flex items-center gap-1.5 rounded-lg border border-white/8 px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-white/14 hover:text-ink"
              >
                <TerminalIcon className="text-[15px]" /> <span className="hidden sm:inline">API</span>
              </button>
              <button
                type="button"
                onClick={() => setAuditOpen(true)}
                aria-label="Activity log"
                className="flex items-center gap-1.5 rounded-lg border border-white/8 px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-white/14 hover:text-ink"
              >
                <HistoryIcon className="text-[15px]" /> <span className="hidden sm:inline">Activity</span>
              </button>
            </>
          ) : null}
          <button
            type="button"
            onClick={() => setVariablesOpen(true)}
            disabled={!workspace}
            aria-label="Variables and secrets"
            className="flex items-center gap-1.5 rounded-lg border border-white/8 px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-white/14 hover:text-ink disabled:opacity-50"
          >
            <BracesIcon className="text-[15px]" /> <span className="hidden sm:inline">Variables</span>
          </button>
          <button
            type="button"
            onClick={() => setCredentialsOpen(true)}
            disabled={!workspace}
            className="flex items-center gap-1.5 rounded-lg border border-white/8 px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-white/14 hover:text-ink disabled:opacity-50"
          >
            <KeyIcon className="text-[15px]" /> <span className="hidden sm:inline">Credentials</span>
          </button>
          <button
            type="button"
            onClick={logout}
            aria-label="Sign out"
            className="flex items-center gap-1.5 rounded-lg border border-white/8 px-2.5 py-1.5 text-[12.5px] text-muted transition-colors hover:border-white/14 hover:text-ink"
          >
            <LogoutIcon className="text-[15px]" /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>

      <CredentialsManager
        open={credentialsOpen}
        workspaceId={workspace?.id ?? null}
        canEdit={canEdit(workspace?.role)}
        onClose={() => setCredentialsOpen(false)}
      />

      <VariablesManager
        open={variablesOpen}
        workspaceId={workspace?.id ?? null}
        canEdit={canEdit(workspace?.role)}
        canManage={canDeleteResources(workspace?.role)}
        onClose={() => setVariablesOpen(false)}
      />

      {workspace ? (
        <>
          <AuditLogView open={auditOpen} workspace={workspace} onClose={() => setAuditOpen(false)} />
          <ApiKeysManager open={apiKeysOpen} workspace={workspace} onClose={() => setApiKeysOpen(false)} />
        </>
      ) : null}
    </header>
  );
}
