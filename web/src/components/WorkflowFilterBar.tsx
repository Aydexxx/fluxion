import { useEffect, useRef, useState } from "react";
import type { Tag } from "../lib/types";
import { SORT_OPTIONS, DEFAULT_SORT, type SortOption, type StatusFilter } from "../lib/workflowFilters";
import { Label, Select, TextInput } from "./Field";
import { FilterIcon, SearchIcon } from "./icons";

interface Props {
  search: string;
  onSearchChange: (v: string) => void;
  sortOption: SortOption;
  onSortChange: (v: SortOption) => void;
  statusFilter: StatusFilter;
  onStatusChange: (v: StatusFilter) => void;
  tagId: string | null;
  onTagChange: (v: string | null) => void;
  tags: Tag[];
  onClear: () => void;
}

/**
 * The compact workflows toolbar: a slim search box plus a single "Filters"
 * popover that tucks sort/status/tag away behind one button (progressive
 * disclosure), so the workflow grid sits high on the page instead of being
 * pushed down by three rows of controls.
 */
export function WorkflowFilterBar({
  search,
  onSearchChange,
  sortOption,
  onSortChange,
  statusFilter,
  onStatusChange,
  tagId,
  onTagChange,
  tags,
  onClear,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The badge counts only the *narrowing* controls (status + tag); a non-default
  // sort is reflected too so the button signals "something's set".
  const activeCount =
    (statusFilter !== "all" ? 1 : 0) + (tagId !== null ? 1 : 0) + (sortOption !== DEFAULT_SORT ? 1 : 0);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex items-center gap-2">
      <div className="relative w-[180px]">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-faint" />
        <TextInput
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search…"
          className="!py-2 pl-9 text-[13px]"
          aria-label="Search workflows"
        />
      </div>

      <div className="relative" ref={ref}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12.5px] font-medium transition-colors"
          style={{
            color: activeCount > 0 ? "var(--color-ink)" : "var(--color-muted)",
            borderColor:
              activeCount > 0 ? "color-mix(in oklab, var(--color-accent) 50%, transparent)" : "rgba(255,255,255,0.08)",
            background: activeCount > 0 ? "color-mix(in oklab, var(--color-accent) 12%, transparent)" : "transparent",
          }}
        >
          <FilterIcon className="text-[14px]" />
          Filters
          {activeCount > 0 ? (
            <span className="flex size-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-white">
              {activeCount}
            </span>
          ) : null}
        </button>

        {open ? (
          <div
            role="dialog"
            aria-label="Filter and sort workflows"
            className="absolute right-0 top-full z-40 mt-1.5 w-64 space-y-3 rounded-xl border border-white/10 bg-base/95 p-3 shadow-2xl backdrop-blur-xl"
          >
            <div>
              <Label htmlFor="filter-sort">Sort by</Label>
              <Select
                id="filter-sort"
                value={sortOption}
                onChange={(e) => onSortChange(e.target.value as SortOption)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="filter-status">Status</Label>
              <Select
                id="filter-status"
                value={statusFilter}
                onChange={(e) => onStatusChange(e.target.value as StatusFilter)}
              >
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            </div>

            <div>
              <Label htmlFor="filter-tag">Tag</Label>
              <Select
                id="filter-tag"
                value={tagId ?? ""}
                onChange={(e) => onTagChange(e.target.value || null)}
                className="capitalize"
              >
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id} className="capitalize">
                    {t.name}
                  </option>
                ))}
              </Select>
            </div>

            {activeCount > 0 ? (
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setOpen(false);
                }}
                className="w-full rounded-lg border border-white/8 px-3 py-1.5 text-[12.5px] font-medium text-muted transition-colors hover:border-white/14 hover:text-ink"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
