import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CardSkeletonGrid, EmptyState, ErrorState, LoadingState, Skeleton } from "../states";

describe("Skeleton / CardSkeletonGrid", () => {
  it("renders a pulsing placeholder", () => {
    const { container } = render(<Skeleton className="h-10" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("h-10");
  });

  it("renders the requested number of card skeletons", () => {
    const { container } = render(<CardSkeletonGrid count={5} />);
    // Outer grid + 5 cards.
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(5);
  });
});

describe("LoadingState", () => {
  it("renders a spinner and an optional label", () => {
    render(<LoadingState label="Loading runs…" />);
    expect(screen.getByText("Loading runs…")).toBeInTheDocument();
  });
});

describe("EmptyState", () => {
  it("renders the title, description, and both actions", () => {
    render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        title="Nothing here yet"
        description="Add your first thing."
        action={<button>Primary</button>}
        secondaryAction={<button>Secondary</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "Nothing here yet" })).toBeInTheDocument();
    expect(screen.getByText("Add your first thing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Primary" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Secondary" })).toBeInTheDocument();
  });

  it("omits the action row when no actions are given", () => {
    render(<EmptyState icon={<svg />} title="Empty" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("shows the message and calls onRetry when the retry button is clicked", async () => {
    const onRetry = vi.fn();
    render(<ErrorState title="Couldn’t load" message="Network down" onRetry={onRetry} />);

    expect(screen.getByRole("heading", { name: "Couldn’t load" })).toBeInTheDocument();
    expect(screen.getByText("Network down")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders no retry affordance when onRetry is absent", () => {
    render(<ErrorState message="boom" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    // Falls back to the default title.
    expect(screen.getByRole("heading", { name: /something went wrong/i })).toBeInTheDocument();
  });
});
