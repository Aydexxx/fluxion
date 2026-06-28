import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../../lib/router", () => ({ navigate: vi.fn() }));

import { MobileEditorGate } from "../MobileEditorGate";
import { useEditor } from "../editorStore";
import { navigate } from "../../lib/router";

afterEach(() => {
  vi.clearAllMocks();
  useEditor.getState().setMobileReadOnly(false);
});

describe("MobileEditorGate", () => {
  it("explains the desktop-first editor and offers a read-only peek", async () => {
    const user = userEvent.setup();
    const onPeek = vi.fn();
    render(<MobileEditorGate onPeek={onPeek} />);

    expect(screen.getByText("The editor shines on desktop")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "View read-only" }));
    expect(onPeek).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Back to workflows/ }));
    expect(navigate).toHaveBeenCalledWith("/");
  });
});

describe("editor mobileReadOnly flag", () => {
  it("toggles the canvas into view-only mode", () => {
    expect(useEditor.getState().mobileReadOnly).toBe(false);
    useEditor.getState().setMobileReadOnly(true);
    expect(useEditor.getState().mobileReadOnly).toBe(true);
  });
});
