import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// Keep the top bar's network-y children quiet; we only need the hamburger.
vi.mock("../../WorkspaceSwitcher", () => ({ WorkspaceSwitcher: () => null }));
vi.mock("../../NotificationBell", () => ({ NotificationBell: () => null }));
vi.mock("../ProfileMenu", () => ({ ProfileMenu: () => null }));

import { AppShell } from "../AppShell";
import { ToastProvider } from "../../ui/toast";
import { useAuth } from "../../../store/auth";
import type { Workspace } from "../../../lib/types";

const WORKSPACE: Workspace = { id: "ws1", name: "Acme", ownerId: "u1", role: "owner" };
const render = (ui: ReactNode) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

/** Stub matchMedia so the mobile breakpoint resolves deterministically. */
function setViewport(mobile: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      matches: mobile && query.includes("767"),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  window.history.pushState({}, "", "/");
  useAuth.setState({ status: "authed", workspace: WORKSPACE, workspaces: [WORKSPACE] });
});

afterEach(() => vi.clearAllMocks());

describe("AppShell mobile navigation", () => {
  it("opens the side panel as a drawer on phones and routes from it", async () => {
    setViewport(true);
    const user = userEvent.setup();
    render(
      <AppShell active="workflows">
        <div />
      </AppShell>,
    );

    await user.click(screen.getByRole("button", { name: "Open menu" }));

    const drawer = await screen.findByTestId("mobile-nav-drawer");
    // The Workspace + Settings groups are reachable inside the drawer.
    expect(within(drawer).getByRole("button", { name: "Runs" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Members" })).toBeInTheDocument();

    await user.click(within(drawer).getByRole("button", { name: "Runs" }));
    expect(window.location.pathname).toBe("/runs");
    // Selecting an item closes the drawer.
    await waitFor(() => expect(screen.queryByTestId("mobile-nav-drawer")).not.toBeInTheDocument());
  });

  it("does not open the drawer on desktop (the persistent rail is used instead)", async () => {
    setViewport(false);
    const user = userEvent.setup();
    render(
      <AppShell active="workflows">
        <div />
      </AppShell>,
    );

    expect(screen.getByTestId("side-nav")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.queryByTestId("mobile-nav-drawer")).not.toBeInTheDocument();
  });
});
