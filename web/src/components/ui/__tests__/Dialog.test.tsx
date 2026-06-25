import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Dialog, DialogBody, DialogFooter, DialogHeader } from "../Dialog";

function Fixture({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open onClose={onClose}>
      <DialogHeader title="Create credential" description="secrets" />
      <DialogBody>
        <label htmlFor="name">Name</label>
        <input id="name" placeholder="Production mailer" />
      </DialogBody>
      <DialogFooter>
        <button>Save</button>
      </DialogFooter>
    </Dialog>
  );
}

describe("Dialog", () => {
  it("renders the title and body content when open", () => {
    render(<Fixture onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Create credential")).toBeInTheDocument();
    // The previously-cut-off Name field must be present and reachable.
    expect(within(dialog).getByPlaceholderText("Production mailer")).toBeInTheDocument();
  });

  it("keeps the body as the single scroll region with pinned header/footer", () => {
    render(<Fixture onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    // The dialog is height-capped and a flex column so the body can scroll internally.
    expect(dialog.className).toMatch(/max-h-\[/);
    expect(dialog.className).toMatch(/flex-col/);
    const scroller = within(dialog).getByText("Name").closest("div.overflow-y-auto");
    expect(scroller).not.toBeNull();
  });

  it("closes on Escape", async () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked but not when the panel is clicked", async () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);
    const dialog = screen.getByRole("dialog");

    await userEvent.click(within(dialog).getByText("Create credential"));
    expect(onClose).not.toHaveBeenCalled();

    // The backdrop is the blurred sibling overlay.
    const backdrop = document.querySelector(".backdrop-blur-sm") as HTMLElement;
    await userEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog on open", () => {
    render(<Fixture onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});
