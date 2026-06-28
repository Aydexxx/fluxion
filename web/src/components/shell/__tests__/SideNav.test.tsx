import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SideNav } from "../SideNav";

function renderNav(overrides: Partial<Parameters<typeof SideNav>[0]> = {}) {
  const props = {
    role: "owner" as const,
    active: "runs" as const,
    openSettings: null,
    collapsed: false,
    onToggleCollapse: vi.fn(),
    onNavigate: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  render(<SideNav {...props} />);
  return props;
}

describe("SideNav", () => {
  it("renders the full Settings group for an owner", () => {
    renderNav({ role: "owner" });
    for (const label of ["Runs", "Analytics", "Members", "Credentials", "Variables", "API keys", "Activity"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
  });

  it("hides admin-only items from a viewer", () => {
    renderNav({ role: "viewer" });
    // Workspace group + the two non-admin settings items remain…
    expect(screen.getByRole("button", { name: "Runs" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Credentials" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Variables" })).toBeInTheDocument();
    // …but Members, API keys and Activity are gone.
    expect(screen.queryByRole("button", { name: "Members" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "API keys" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activity" })).not.toBeInTheDocument();
  });

  it("marks the active section with aria-current", () => {
    renderNav({ active: "analytics" });
    expect(screen.getByRole("button", { name: "Analytics" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Runs" })).not.toHaveAttribute("aria-current");
  });

  it("highlights the open settings manager", () => {
    renderNav({ openSettings: "credentials" });
    expect(screen.getByRole("button", { name: "Credentials" })).toHaveAttribute("aria-current", "page");
  });

  it("routes Workspace items via onNavigate and opens managers via onOpenSettings", async () => {
    const user = userEvent.setup();
    const props = renderNav({ role: "admin" });

    await user.click(screen.getByRole("button", { name: "Analytics" }));
    expect(props.onNavigate).toHaveBeenCalledWith("/analytics");

    await user.click(screen.getByRole("button", { name: "Members" }));
    expect(props.onOpenSettings).toHaveBeenCalledWith("members");
  });

  it("hides text labels when collapsed but keeps the items reachable by title", () => {
    renderNav({ collapsed: true });
    // Label text is dropped in the icon-only rail…
    expect(screen.queryByText("Runs")).not.toBeInTheDocument();
    // …but the button is still present, titled for tooltip/accessibility.
    expect(screen.getByRole("button", { name: "Runs" })).toBeInTheDocument();
    expect(screen.getByTestId("side-nav")).toHaveAttribute("data-collapsed", "true");
  });

  it("toggles collapse through the footer control", async () => {
    const user = userEvent.setup();
    const props = renderNav({ collapsed: false });
    await user.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(props.onToggleCollapse).toHaveBeenCalled();
  });
});
