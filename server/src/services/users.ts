import type { User as PrismaUser } from "../generated/prisma/client";

/** Where the user lands after signing in (a section of the app). */
export type DefaultLanding = "workflows" | "templates" | "runs" | "analytics";

/** User-tunable preferences. Stored as JSON on the User row; all fields optional. */
export interface UserPreferences {
  defaultLanding?: DefaultLanding;
}

const LANDINGS: DefaultLanding[] = ["workflows", "templates", "runs", "analytics"];

/** Narrow an untrusted JSON blob into a clean preferences object. */
export function parsePreferences(value: unknown): UserPreferences {
  if (!value || typeof value !== "object") return {};
  const raw = value as Record<string, unknown>;
  const prefs: UserPreferences = {};
  if (typeof raw.defaultLanding === "string" && LANDINGS.includes(raw.defaultLanding as DefaultLanding)) {
    prefs.defaultLanding = raw.defaultLanding as DefaultLanding;
  }
  return prefs;
}

/** Wire-safe view of a User (never includes passwordHash). */
export interface SafeUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  preferences: UserPreferences;
  createdAt: string;
}

/** Maps a Prisma User row to the wire-safe view. */
export function toSafeUser(user: PrismaUser): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    preferences: parsePreferences(user.preferences),
    createdAt: user.createdAt.toISOString(),
  };
}
