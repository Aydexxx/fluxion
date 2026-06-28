import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("../../lib/router", () => ({ navigate: vi.fn() }));
vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    authApi: { ...actual.authApi, updateProfile: vi.fn(), changePassword: vi.fn() },
  };
});

import { ProfilePage } from "../ProfilePage";
import { authApi } from "../../lib/api";
import { ToastProvider } from "../../components/ui/toast";
import { useAuth } from "../../store/auth";
import type { User, Workspace } from "../../lib/types";

const USER: User = {
  id: "u1",
  email: "ada@example.com",
  name: "Ada",
  avatarUrl: null,
  preferences: { defaultLanding: "workflows" },
  createdAt: new Date().toISOString(),
};

const WORKSPACE: Workspace = { id: "ws1", name: "Acme", ownerId: "u1", role: "admin" };

const render = (ui: ReactNode) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  vi.mocked(authApi.updateProfile).mockResolvedValue({ ...USER, name: "Ada Lovelace" });
  vi.mocked(authApi.changePassword).mockResolvedValue();
  useAuth.setState({ status: "authed", user: USER, workspaces: [WORKSPACE], workspace: WORKSPACE });
});

afterEach(() => vi.clearAllMocks());

describe("ProfilePage", () => {
  it("shows email read-only and lists workspaces with the user's role", () => {
    render(<ProfilePage />);
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(screen.getByText("Admin")).toBeInTheDocument();
  });

  it("saves a changed display name", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toBeDisabled(); // nothing changed yet

    const name = screen.getByLabelText("Display name");
    await user.clear(name);
    await user.type(name, "Ada Lovelace");
    expect(save).toBeEnabled();

    await user.click(save);
    await waitFor(() => expect(authApi.updateProfile).toHaveBeenCalledWith({ name: "Ada Lovelace" }));
    // The store reflects the returned user.
    await waitFor(() => expect(useAuth.getState().user?.name).toBe("Ada Lovelace"));
  });

  it("validates the password form before allowing a change", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    const change = screen.getByRole("button", { name: "Change password" });
    expect(change).toBeDisabled();

    await user.type(screen.getByLabelText("Current password"), "Password123!");
    await user.type(screen.getByLabelText("New password"), "short");
    // Too short → still disabled + inline error.
    expect(screen.getByText("Must be at least 8 characters.")).toBeInTheDocument();
    expect(change).toBeDisabled();

    await user.clear(screen.getByLabelText("New password"));
    await user.type(screen.getByLabelText("New password"), "BrandNew456?");
    await user.type(screen.getByLabelText("Confirm new password"), "Different1");
    expect(screen.getByText("Passwords don't match.")).toBeInTheDocument();
    expect(change).toBeDisabled();

    await user.clear(screen.getByLabelText("Confirm new password"));
    await user.type(screen.getByLabelText("Confirm new password"), "BrandNew456?");
    expect(change).toBeEnabled();

    await user.click(change);
    await waitFor(() => expect(authApi.changePassword).toHaveBeenCalledWith("Password123!", "BrandNew456?"));
  });

  it("saves the default landing preference on change", async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.selectOptions(screen.getByLabelText("Default landing section"), "runs");
    await waitFor(() =>
      expect(authApi.updateProfile).toHaveBeenCalledWith({ preferences: { defaultLanding: "runs" } }),
    );
  });
});
