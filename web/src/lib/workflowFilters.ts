import type { SortDir, WorkflowSortBy } from "./types";

/** A single friendly dropdown value that maps onto the server's (sortBy, sortDir) pair. */
export const SORT_OPTIONS = [
  { value: "updated", label: "Recently updated", sortBy: "updatedAt" as WorkflowSortBy, sortDir: "desc" as SortDir },
  { value: "created", label: "Recently created", sortBy: "createdAt" as WorkflowSortBy, sortDir: "desc" as SortDir },
  { value: "name-asc", label: "Name (A–Z)", sortBy: "name" as WorkflowSortBy, sortDir: "asc" as SortDir },
  { value: "name-desc", label: "Name (Z–A)", sortBy: "name" as WorkflowSortBy, sortDir: "desc" as SortDir },
];
export type SortOption = (typeof SORT_OPTIONS)[number]["value"];
export const DEFAULT_SORT: SortOption = "updated";

export type StatusFilter = "all" | "active" | "inactive";
