import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Avatar } from "../Avatar";

describe("Avatar", () => {
  it("renders the uploaded image when an avatarUrl is given", () => {
    render(<Avatar name="Ada Lovelace" avatarUrl="data:image/png;base64,abc" />);
    const img = screen.getByRole("img", { name: /Ada Lovelace/ });
    expect(img).toHaveAttribute("src", "data:image/png;base64,abc");
  });

  it("falls back to initials from the name", () => {
    render(<Avatar name="Ada Lovelace" avatarUrl={null} />);
    expect(screen.getByText("AL")).toBeInTheDocument();
  });

  it("derives initials from the email when there's no name", () => {
    render(<Avatar email="grace@example.com" avatarUrl={null} />);
    expect(screen.getByText("GR")).toBeInTheDocument();
  });

  it("uses an explicit color override for the initials background", () => {
    render(<Avatar name="Bo" avatarUrl={null} color="#123456" />);
    expect(screen.getByText("BO")).toHaveStyle({ background: "#123456" });
  });
});
