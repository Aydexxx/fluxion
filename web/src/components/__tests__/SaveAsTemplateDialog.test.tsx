import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render as rtlRender, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, templateApi: { ...actual.templateApi, createCustom: vi.fn() } };
});

import { SaveAsTemplateDialog } from "../SaveAsTemplateDialog";
import { templateApi } from "../../lib/api";
import { ToastProvider } from "../ui/toast";

const render = (ui: ReactNode) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

beforeEach(() => {
  vi.mocked(templateApi.createCustom).mockResolvedValue({ id: "tpl1" } as never);
});

afterEach(() => vi.clearAllMocks());

describe("SaveAsTemplateDialog", () => {
  it("captures the workflow with the entered name + description", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <SaveAsTemplateDialog open workflowId="wf1" defaultName="My flow" onClose={onClose} onSaved={onSaved} />,
    );

    // Name pre-fills from the workflow.
    expect(screen.getByLabelText("Template name")).toHaveValue("My flow");

    await user.clear(screen.getByLabelText("Template name"));
    await user.type(screen.getByLabelText("Template name"), "Onboarding");
    await user.type(screen.getByLabelText("Description"), "Welcome flow");
    await user.click(screen.getByRole("button", { name: "Save template" }));

    await waitFor(() =>
      expect(templateApi.createCustom).toHaveBeenCalledWith({
        workflowId: "wf1",
        name: "Onboarding",
        description: "Welcome flow",
      }),
    );
    expect(onSaved).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("disables saving when there is no workflow or name", async () => {
    const user = userEvent.setup();
    render(<SaveAsTemplateDialog open workflowId="wf1" defaultName="" onClose={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Save template" })).toBeDisabled();
    await user.type(screen.getByLabelText("Template name"), "Now valid");
    expect(screen.getByRole("button", { name: "Save template" })).toBeEnabled();
  });
});
