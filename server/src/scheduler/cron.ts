// One cron field: *, */n, n, ranges (a-b), lists (a,b,c), and steps (a-b/n).
const FIELD = /^(\*(\/\d+)?|\d+(-\d+)?(\/\d+)?(,\d+(-\d+)?(\/\d+)?)*)$/;

/**
 * Permissive validity check for a standard 5-field (or 6-field with seconds)
 * cron expression. Not a full semantic validator — it rejects obviously
 * malformed input so a bad cron never reaches the scheduler.
 */
export function isValidCron(expression: unknown): expression is string {
  if (typeof expression !== "string") return false;
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5 && fields.length !== 6) return false;
  return fields.every((field) => FIELD.test(field));
}
