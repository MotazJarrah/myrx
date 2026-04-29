import type { Express, Request, Response } from "express";
import type { Server } from "node:http";
import { storage, stripPassword } from "./storage";
import {
  registerSchema,
  loginSchema,
  insertWorkoutSchema,
} from "@shared/schema";
import {
  attachUser,
  requireAuth,
  hashPassword,
  verifyPassword,
  setSessionCookie,
  clearSessionCookie,
  SESSION_TTL_MS,
} from "./auth";

// Simple in-memory rate limiter (per-IP + per-route).
// Resets counts in a rolling window. Sufficient for single-instance deployment.
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count++;
  return true;
}

function clientIp(req: Request): string {
  const xff = req.headers["x-forwarded-for"];
  const header = Array.isArray(xff) ? xff[0] : xff;
  return header?.split(",")[0]?.trim() || req.socket.remoteAddress || "unknown";
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ─── Middleware ─────────────────────────────────────────────────────
  app.use("/api", attachUser);

  // ─── Health ─────────────────────────────────────────────────────────
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", time: Date.now() });
  });

  // ─── Auth ───────────────────────────────────────────────────────────
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    const ip = clientIp(req);
    if (!rateLimit(`register:${ip}`, 10, 60 * 60 * 1000)) {
      return res.status(429).json({ message: "Too many attempts. Try again later." });
    }

    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid input" });
    }
    const { username, email, password } = parsed.data;

    const existingByUsername = await storage.getUserByUsername(username);
    if (existingByUsername) {
      return res.status(409).json({ message: "Username is already taken" });
    }
    const existingByEmail = await storage.getUserByEmail(email);
    if (existingByEmail) {
      return res.status(409).json({ message: "An account with that email already exists" });
    }

    const passwordHash = await hashPassword(password);
    const user = await storage.createUser({ username, email, passwordHash });
    const session = await storage.createSession(user.id, SESSION_TTL_MS);
    setSessionCookie(res, session.id);

    res.status(201).json({ user: stripPassword(user) });
  });

  app.post("/api/auth/login", async (req: Request, res: Response) => {
    const ip = clientIp(req);
    if (!rateLimit(`login:${ip}`, 15, 15 * 60 * 1000)) {
      return res.status(429).json({ message: "Too many login attempts. Try again later." });
    }

    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid credentials" });
    }
    const { identifier, password } = parsed.data;

    const user = await storage.getUserByIdentifier(identifier);
    // Constant-ish timing: always run a bcrypt compare, even on unknown user.
    const valid = user
      ? await verifyPassword(password, user.passwordHash)
      : await verifyPassword(password, "$2a$12$abcdefghijklmnopqrstuu.placeholderhashforTimingSafe/x.");

    if (!user || !valid) {
      return res.status(401).json({ message: "Incorrect username or password" });
    }

    const session = await storage.createSession(user.id, SESSION_TTL_MS);
    setSessionCookie(res, session.id);
    res.json({ user: stripPassword(user) });
  });

  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    if (req.sessionId) await storage.deleteSession(req.sessionId);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get("/api/auth/me", (req: Request, res: Response) => {
    if (!req.user) return res.status(401).json({ message: "Not signed in" });
    res.json({ user: req.user });
  });

  // ─── Workouts ───────────────────────────────────────────────────────
  app.get("/api/workouts", requireAuth, async (req: Request, res: Response) => {
    const list = await storage.listWorkouts(req.user!.id);
    res.json(list);
  });

  app.post("/api/workouts", requireAuth, async (req: Request, res: Response) => {
    const parsed = insertWorkoutSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.issues[0]?.message || "Invalid input" });
    }
    const created = await storage.createWorkout(req.user!.id, parsed.data);
    res.status(201).json(created);
  });

  app.delete("/api/workouts/:id", requireAuth, async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const ok = await storage.deleteWorkout(req.user!.id, id);
    if (!ok) return res.status(404).json({ message: "Not found" });
    res.json({ ok: true });
  });

  return httpServer;
}
