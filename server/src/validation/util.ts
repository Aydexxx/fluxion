/** True if at least one key in `data` has a defined value (used to reject empty PATCH/PUT bodies). */
export function hasAtLeastOneField(data: Record<string, unknown>): boolean {
  return Object.values(data).some((value) => value !== undefined);
}
