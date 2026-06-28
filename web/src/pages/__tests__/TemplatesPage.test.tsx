import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("../../lib/router", () => ({ navigate: vi.fn() }));
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    templateApi: {
      ...actual.templateApi,
      list: vi.fn(),
      listCustom: vi.fn(),
      instantiateCustom: vi.fn(),
    },
  };
});

import { TemplatesPage } from "../TemplatesPage";
import { templateApi } from "../../lib/api";
import { navigate } from "../../lib/router";
import { ToastProvider } from "../../components/ui/toast";
import { useAuth } from "../../store/auth";
import type { TemplateSummary, UserTemplate, Workspace } from "../../lib/types";

const WORKSPACE: Workspace = { id: "ws1", name: "Acme", ownerId: "u1", role: "editor" };

const BUILTIN: TemplateSummary = {
  id: "b1",
  name: "Built-in Flow",
  description: "seeded",
  category: "AI",
  nodeTypes: ["trigger.manual"],
  definition: { nodes: [], edges: [] },
  kind: "builtin",
};

const CUSTOM: UserTemplate = {
  id: "c1",
  name: "My Saved Flow",
  description: "mine",
  category: "Custom",
  nodeTypes: ["trigger.manual", "action.slack"],
  definition: { nodes: [], edges: [] },
  kind: "custom",
  workspaceId: "ws1",
  createdByName: "Ada",
  createdAt: new Date().toISOString(),
};

const render = (ui: ReactNode) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

function setRole(role: Workspace["role"]) {
  useAuth.setState({ status: "authed", workspace: { ...WORKSPACE, role }, workspaces: [{ ...WORKSPACE, role }] });
}

beforeEach(() => {
  vi.mocked(templateApi.list).mockResolvedValue([BUILTIN]);
  vi.mocked(templateApi.listCustom).mockResolvedValue([CUSTOM]);
  vi.mocked(templateApi.instantiateCustom).mockResolvedValue({ id: "new-wf" } as never);
  setRole("editor");
});

afterEach(() => vi.clearAllMocks());

describe("TemplatesPage", () => {
  it("separates Built-in and My Templates into tabs", async () => {
    const user = userEvent.setup();
    render(<TemplatesPage />);

    // Built-in tab is shown first.
    expect(await screen.findByText("Built-in Flow")).toBeInTheDocument();
    expect(screen.queryByText("My Saved Flow")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /My Templates/ }));
    expect(await screen.findByText("My Saved Flow")).toBeInTheDocument();
    expect(screen.queryByText("Built-in Flow")).not.toBeInTheDocument();
  });

  it("shows manage actions on custom templates for editors", async () => {
    const user = userEvent.setup();
    render(<TemplatesPage />);
    await user.click(screen.getByRole("button", { name: /My Templates/ }));
    await screen.findByText("My Saved Flow");

    expect(screen.getByRole("button", { name: "Edit My Saved Flow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete My Saved Flow" })).toBeInTheDocument();
  });

  it("hides manage actions from viewers (RBAC)", async () => {
    setRole("viewer");
    const user = userEvent.setup();
    render(<TemplatesPage />);
    await user.click(screen.getByRole("button", { name: /My Templates/ }));
    await screen.findByText("My Saved Flow");

    expect(screen.queryByRole("button", { name: "Edit My Saved Flow" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete My Saved Flow" })).not.toBeInTheDocument();
    // …but a viewer can still use it.
    expect(screen.getByRole("button", { name: "Use template" })).toBeInTheDocument();
  });

  it("instantiates a custom template and opens the editor", async () => {
    const user = userEvent.setup();
    render(<TemplatesPage />);
    await user.click(screen.getByRole("button", { name: /My Templates/ }));
    const card = (await screen.findByText("My Saved Flow")).closest("div")!;

    await user.click(within(card.parentElement as HTMLElement).getByRole("button", { name: "Use template" }));

    await waitFor(() => expect(templateApi.instantiateCustom).toHaveBeenCalledWith("c1"));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/workflows/new-wf"));
  });
});
