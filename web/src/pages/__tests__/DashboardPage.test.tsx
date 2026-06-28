import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

// Mock the network + router before importing the page. The api module is only
// partially mocked so the auth store's real imports (setToken etc.) still exist.
vi.mock("../../lib/router", () => ({ navigate: vi.fn() }));
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    workflowApi: { ...actual.workflowApi, list: vi.fn(), create: vi.fn(), remove: vi.fn() },
    folderApi: { ...actual.folderApi, list: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() },
    tagApi: { ...actual.tagApi, list: vi.fn() },
  };
});

import { DashboardPage } from "../DashboardPage";
import { workflowApi, folderApi, tagApi } from "../../lib/api";
import { ToastProvider } from "../../components/ui/toast";
import { useAuth } from "../../store/auth";
import type { Folder, Workspace } from "../../lib/types";

const WORKSPACE: Workspace = { id: "ws1", name: "Acme", ownerId: "u1", role: "owner" };
const MARKETING: Folder = {
  id: "f1",
  workspaceId: "ws1",
  name: "Marketing",
  workflowCount: 0,
  createdAt: "",
  updatedAt: "",
};

const renderPage = (ui: ReactNode) => render(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  vi.mocked(folderApi.list).mockResolvedValue([MARKETING]);
  vi.mocked(tagApi.list).mockResolvedValue([]);
  vi.mocked(workflowApi.list).mockResolvedValue([]);
  vi.mocked(workflowApi.create).mockResolvedValue({ id: "new-wf" } as never);
  useAuth.setState({ status: "authed", workspace: WORKSPACE, workspaces: [WORKSPACE] });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("DashboardPage — folder-aware creation", () => {
  it("creates inside the active folder when one is selected", async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />);

    // Select the Marketing folder chip, then create.
    await user.click(await screen.findByRole("tab", { name: /Marketing/ }));
    await user.click(screen.getByRole("button", { name: "New workflow" }));

    await waitFor(() =>
      expect(workflowApi.create).toHaveBeenCalledWith("ws1", "Untitled workflow", { folderId: "f1" }),
    );
  });

  it("creates unfiled when viewing All", async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />);

    // Wait for the initial load, then create without picking a folder.
    await screen.findByRole("tab", { name: /Marketing/ });
    await user.click(screen.getByRole("button", { name: "New workflow" }));

    await waitFor(() =>
      expect(workflowApi.create).toHaveBeenCalledWith("ws1", "Untitled workflow", { folderId: undefined }),
    );
  });

  it("creates unfiled when viewing the Unfiled chip", async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />);

    await user.click(await screen.findByRole("tab", { name: "Unfiled" }));
    await user.click(screen.getByRole("button", { name: "New workflow" }));

    await waitFor(() =>
      expect(workflowApi.create).toHaveBeenCalledWith("ws1", "Untitled workflow", { folderId: undefined }),
    );
  });
});

describe("DashboardPage — breadcrumb", () => {
  it("reflects the active folder and returns to All from the root crumb", async () => {
    const user = userEvent.setup();
    renderPage(<DashboardPage />);

    const crumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    // At "All" the breadcrumb is just the root.
    expect(within(crumb).queryByText("Marketing")).not.toBeInTheDocument();

    await user.click(await screen.findByRole("tab", { name: /Marketing/ }));
    expect(within(crumb).getByText("Marketing")).toBeInTheDocument();

    // Clicking the root crumb clears the folder.
    await user.click(within(crumb).getByRole("button", { name: "Workflows" }));
    expect(within(crumb).queryByText("Marketing")).not.toBeInTheDocument();
  });
});
