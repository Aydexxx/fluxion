import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkflowFilterBar } from "../WorkflowFilterBar";
import type { Tag } from "../../lib/types";

const TAGS: Tag[] = [
  { id: "t1", name: "billing" } as Tag,
  { id: "t2", name: "ops" } as Tag,
];

function setup(overrides: Partial<Parameters<typeof WorkflowFilterBar>[0]> = {}) {
  const props = {
    search: "",
    onSearchChange: vi.fn(),
    sortOption: "updated" as const,
    onSortChange: vi.fn(),
    statusFilter: "all" as const,
    onStatusChange: vi.fn(),
    tagId: null,
    onTagChange: vi.fn(),
    tags: TAGS,
    onClear: vi.fn(),
    ...overrides,
  };
  render(<WorkflowFilterBar {...props} />);
  return props;
}

describe("WorkflowFilterBar", () => {
  it("keeps sort/status/tag tucked behind the Filters popover", async () => {
    const user = userEvent.setup();
    setup();
    // Hidden until opened — that's the whole point of the compact toolbar.
    expect(screen.queryByLabelText("Sort by")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.getByLabelText("Sort by")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    expect(screen.getByLabelText("Tag")).toBeInTheDocument();
  });

  it("routes each control change to its handler", async () => {
    const user = userEvent.setup();
    const props = setup();

    await user.type(screen.getByLabelText("Search workflows"), "abc");
    expect(props.onSearchChange).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.selectOptions(screen.getByLabelText("Status"), "active");
    expect(props.onStatusChange).toHaveBeenCalledWith("active");

    await user.selectOptions(screen.getByLabelText("Sort by"), "name-asc");
    expect(props.onSortChange).toHaveBeenCalledWith("name-asc");

    await user.selectOptions(screen.getByLabelText("Tag"), "t2");
    expect(props.onTagChange).toHaveBeenCalledWith("t2");
  });

  it("badges the number of active filters and offers a Clear action", async () => {
    const user = userEvent.setup();
    const props = setup({ statusFilter: "active", tagId: "t1", sortOption: "name-asc" });
    // status + tag + non-default sort → 3.
    expect(screen.getByRole("button", { name: /Filters/ })).toHaveTextContent("3");

    await user.click(screen.getByRole("button", { name: /Filters/ }));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(props.onClear).toHaveBeenCalled();
  });

  it("shows no badge and no Clear when nothing is set", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getByRole("button", { name: /Filters/ })).not.toHaveTextContent(/[0-9]/);
    await user.click(screen.getByRole("button", { name: /Filters/ }));
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});
