import type { User as PrismaUser } from "../generated/prisma/client";

/** Wire-safe view of a User (never includes passwordHash). */
export interface SafeUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/** Maps a Prisma User row to the wire-safe view. */
export function toSafeUser(user: PrismaUser): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}
