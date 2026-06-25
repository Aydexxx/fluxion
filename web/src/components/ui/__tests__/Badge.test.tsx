import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "../Badge";

describe("Badge", () => {
  it("renders its label", () => {
    render(<Badge color="#34d0a8">Active</Badge>);
    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("applies the given color to the pill text", () => {
    render(<Badge color="#34d0a8">Active</Badge>);
    // jest-dom normalizes hex → rgb for the comparison.
    expect(screen.getByText("Active")).toHaveStyle({ color: "#34d0a8" });
  });

  it("renders a status dot by default and omits it when dot=false", () => {
    const { container, rerender } = render(<Badge color="#fff">A</Badge>);
    // label text node + the dot span
    expect(container.querySelectorAll("span")).toHaveLength(2);
    rerender(
      <Badge color="#fff" dot={false}>
        A
      </Badge>,
    );
    expect(container.querySelectorAll("span")).toHaveLength(1);
  });
});
