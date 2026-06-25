import { describe, expect, it } from "vitest";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast, toast as imperativeToast } from "../toast";

function Trigger() {
  const toast = useToast();
  return (
    <div>
      <button onClick={() => toast.success("Saved")}>save</button>
      <button onClick={() => toast.error("Run failed")}>fail</button>
      <button
        onClick={() => {
          const id = toast.loading("Working…");
          toast.update(id, { kind: "success", message: "Done" });
        }}
      >
        loading
      </button>
      <button onClick={() => toast.success("Bye", { duration: 60 })}>quick</button>
    </div>
  );
}

describe("Toasts", () => {
  it("shows a success toast with a polite live role", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText("save"));
    const t = await screen.findByText("Saved");
    expect(t).toBeInTheDocument();
    expect(t.closest("[role='status']")).not.toBeNull();
  });

  it("uses an assertive alert role for errors", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText("fail"));
    const t = await screen.findByText("Run failed");
    expect(t.closest("[role='alert']")).not.toBeNull();
  });

  it("transitions a loading toast to success via update", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText("loading"));
    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Working…")).not.toBeInTheDocument();
  });

  it("auto-dismisses a toast after its duration", async () => {
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByText("quick"));
    expect(screen.getByText("Bye")).toBeInTheDocument();
    await waitForElementToBeRemoved(() => screen.queryByText("Bye"), { timeout: 2000 });
  });

  it("bridges the imperative toast() helper to the mounted provider", async () => {
    render(
      <ToastProvider>
        <span />
      </ToastProvider>,
    );
    imperativeToast.info("From a store");
    expect(await screen.findByText("From a store")).toBeInTheDocument();
  });
});
