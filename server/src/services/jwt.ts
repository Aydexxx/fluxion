import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

/** Decoded payload of a Fluxion access token. */
export interface AccessTokenPayload {
  /** Subject: the authenticated user's id. */
  sub: string;
}

// JWT_EXPIRES_IN is a free-form env string (e.g. "7d"); jsonwebtoken's types
// narrow `expiresIn` to a specific literal union, so cast at this one boundary.
const signOptions: SignOptions = { expiresIn: env.jwtExpiresIn as SignOptions["expiresIn"] };

/** Sign a new access token for the given user id. */
export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId }, env.jwtSecret, signOptions);
}

/** Verify and decode an access token, throwing if it is invalid or expired. */
export function verifyAccessToken(token: string): AccessTokenPayload {
  const decoded = jwt.verify(token, env.jwtSecret);
  if (typeof decoded === "string" || typeof decoded.sub !== "string") {
    throw new Error("Malformed token payload");
  }
  return { sub: decoded.sub };
}
