import type { ComponentType, SVGProps } from "react";
import type { WorkspaceRole } from "../../lib/types";
import { canManageMembers } from "../../lib/permissions";
import {
  ChartIcon,
  GridIcon,
  HistoryIcon,
  KeyIcon,
  BracesIcon,
  SparkIcon,
  TerminalIcon,
  UsersIcon,
} from "../icons";

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

/** The two primary destinations that live in the slim top bar. */
export type PrimaryKey = "workflows" | "templates";
/** Side-panel "Workspace" group — secondary destinations that are real routes. */
export type WorkspaceNavKey = "runs" | "analytics";
/** Side-panel "Settings" group — admin/config surfaces that open as managers. */
export type SettingsKey = "members" | "credentials" | "variables" | "apiKeys" | "activity";

/** The union the shell uses to drive active-state highlighting. */
export type ActiveSection = PrimaryKey | WorkspaceNavKey | SettingsKey;

export interface RouteItem<K extends string> {
  key: K;
  label: string;
  path: string;
  icon: Icon;
}

export interface SettingsItem {
  key: SettingsKey;
  label: string;
  icon: Icon;
  /** Whether a member with `role` is allowed to see this item at all. */
  visible: (role: WorkspaceRole | undefined) => boolean;
}

/** Primary tabs in the slim top bar — always available. */
export const PRIMARY_TABS: RouteItem<PrimaryKey>[] = [
  { key: "workflows", label: "Workflows", path: "/", icon: GridIcon },
  { key: "templates", label: "Templates", path: "/templates", icon: SparkIcon },
];

/** Side-panel "Workspace" group: observability surfaces, readable by every role. */
export const WORKSPACE_NAV: RouteItem<WorkspaceNavKey>[] = [
  { key: "runs", label: "Runs", path: "/runs", icon: HistoryIcon },
  { key: "analytics", label: "Analytics", path: "/analytics", icon: ChartIcon },
];

/**
 * Side-panel "Settings" group: the admin/config items, consolidated out of the
 * old crowded top bar. Each carries its own RBAC predicate so a role only ever
 * sees what it can use (the server re-checks regardless).
 */
export const SETTINGS_NAV: SettingsItem[] = [
  { key: "members", label: "Members", icon: UsersIcon, visible: canManageMembers },
  { key: "credentials", label: "Credentials", icon: KeyIcon, visible: () => true },
  { key: "variables", label: "Variables", icon: BracesIcon, visible: () => true },
  { key: "apiKeys", label: "API keys", icon: TerminalIcon, visible: canManageMembers },
  { key: "activity", label: "Activity", icon: HistoryIcon, visible: canManageMembers },
];

/** The Settings items a given role is permitted to see. */
export function visibleSettings(role: WorkspaceRole | undefined): SettingsItem[] {
  return SETTINGS_NAV.filter((item) => item.visible(role));
}
