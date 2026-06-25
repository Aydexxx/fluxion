import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmHost, confirm } from "../confirm";

describe("confirm()", () => {
  it("resolves true when confirmed and false when cancelled", async () => {
    render(<ConfirmHost />);

    // Nothing shown until confirm() is called.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    const first = confirm({ title: "Delete workflow?", confirmLabel: "Delete", destructive: true });
    expect(await screen.findByText("Delete workflow?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await first).toBe(true);

    const second = confirm({ title: "Delete again?" });
    expect(await screen.findByText("Delete again?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await second).toBe(false);
  });
});
