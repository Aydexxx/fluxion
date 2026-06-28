import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { ToastProvider } from "../../ui/toast";
import { useAuth } from "../../../store/auth";
import type { Workspace } from "../../../lib/types";

// The settings managers call useToast() at the top of their body even while
// closed, so the shell must render inside a ToastProvider.
const render = (ui: ReactNode) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

// The slim top bar pulls in the notification socket, workspace switcher and the
// invitations fetch — none of which this layout test cares about. Stub it so the
// shell's rail + persistence behaviour can be exercised in isolation.
vi.mock("../SlimTopBar", () => ({
  SlimTopBar: ({ active }: { active: string }) => <div data-testid="topbar" data-active={active} />,
}));

// Imported after the mock is registered.
import { AppShell } from "../AppShell";

const WORKSPACE: Workspace = { id: "ws1", name: "Acme", ownerId: "u1", role: "owner" };
const COLLAPSE_KEY = "fluxion.nav.collapsed";

function setWorkspace(role: Workspace["role"] = "owner") {
  useAuth.setState({ workspace: { ...WORKSPACE, role }, workspaces: [{ ...WORKSPACE, role }] });
}

beforeEach(() => {
  localStorage.clear();
  window.history.pushState({}, "", "/");
  setWorkspace();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AppShell", () => {
  it("renders the rail and tells the top bar which section is active", () => {
    render(
      <AppShell active="runs">
        <div>page body</div>
      </AppShell>,
    );
    expect(screen.getByTestId("topbar")).toHaveAttribute("data-active", "runs");
    expect(screen.getByTestId("side-nav")).toBeInTheDocument();
    expect(screen.getByText("page body")).toBeInTheDocument();
  });

  it("keeps routing intact: clicking a rail item updates the URL", async () => {
    const user = userEvent.setup();
    render(
      <AppShell active="workflows">
        <div />
      </AppShell>,
    );
    await user.click(screen.getByRole("button", { name: "Analytics" }));
    expect(window.location.pathname).toBe("/analytics");
  });

  it("persists the collapsed state and restores it on remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      <AppShell active="workflows">
        <div />
      </AppShell>,
    );

    // Starts expanded.
    expect(screen.getByTestId("side-nav")).toHaveAttribute("data-collapsed", "false");

    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(screen.getByTestId("side-nav")).toHaveAttribute("data-collapsed", "true");
    expect(localStorage.getItem(COLLAPSE_KEY)).toBe("1");

    // Remount: the rail should come back collapsed from the persisted preference.
    unmount();
    render(
      <AppShell active="workflows">
        <div />
      </AppShell>,
    );
    expect(screen.getByTestId("side-nav")).toHaveAttribute("data-collapsed", "true");
  });

  it("respects role when building the rail (viewers see no admin items)", () => {
    setWorkspace("viewer");
    render(
      <AppShell active="workflows">
        <div />
      </AppShell>,
    );
    expect(screen.queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credentials" })).toBeInTheDocument();
  });
});
