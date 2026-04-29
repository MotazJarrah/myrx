import bcrypt from "bcryptjs";
import type { Request, Response, NextFunction } from "express";
import { storage, stripPassword } from "./storage";
import type { PublicUser } from "@shared/schema";

export const SESSION_COOKIE = "apex_sid";
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
export const BCRYPT_ROUNDS = 12;

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser;
      sessionId?: string;
    }
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

export function setSessionCookie(res: Response, sid: string) {
  res.cookie(SESSION_COOKIE, sid, {
    httpOnly: true,
    secure: true, // always require HTTPS; behind the proxy this is terminated upstream
    sameSite: "lax",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

/**
 * Attach the authenticated user (if any) to the request.
 * Does not block unauthenticated requests — use requireAuth for that.
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction) {
  try {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (!sid || typeof sid !== "string") return next();
    const session = await storage.getSession(sid);
    if (!session) return next();
    const user = await storage.getUserById(session.userId);
    if (!user) return next();
    req.user = stripPassword(user);
    req.sessionId = session.id;
    next();
  } catch {
    // Fail open for attachUser — requireAuth will reject if needed.
    next();
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}
