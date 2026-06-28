import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OnboardingTour, type TourStep } from "../OnboardingTour";

const STEPS: TourStep[] = [
  { title: "Welcome", body: "First step." },
  { title: "Templates", body: "Second step." },
];
const KEY = "fluxion.tour.test";

const tick = () => new Promise((r) => setTimeout(r, 30));

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("OnboardingTour", () => {
  it("steps through and remembers completion", async () => {
    const user = userEvent.setup();
    render(<OnboardingTour steps={STEPS} storageKey={KEY} startDelay={0} />);

    // First step appears.
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("1 / 2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Templates")).toBeInTheDocument();

    // Last step finishes the tour and persists "seen".
    await user.click(screen.getByRole("button", { name: "Got it" }));
    await waitFor(() => expect(screen.queryByText("Templates")).not.toBeInTheDocument());
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("can be skipped, which also marks it seen", async () => {
    const user = userEvent.setup();
    render(<OnboardingTour steps={STEPS} storageKey={KEY} startDelay={0} />);
    await screen.findByText("Welcome");

    await user.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByText("Welcome")).not.toBeInTheDocument());
    expect(localStorage.getItem(KEY)).toBe("1");
  });

  it("never shows once it has been seen", async () => {
    localStorage.setItem(KEY, "1");
    render(<OnboardingTour steps={STEPS} storageKey={KEY} startDelay={0} />);
    await tick();
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
  });

  it("stays hidden while disabled", async () => {
    render(<OnboardingTour steps={STEPS} storageKey={KEY} startDelay={0} enabled={false} />);
    await tick();
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
  });

  it("skips steps whose anchor is missing, showing nothing if none remain", async () => {
    render(
      <OnboardingTour
        steps={[{ target: '[data-tour="not-here"]', title: "Anchored", body: "x" }]}
        storageKey={KEY}
        startDelay={0}
      />,
    );
    await tick();
    expect(screen.queryByText("Anchored")).not.toBeInTheDocument();
  });
});
