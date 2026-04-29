import { users, sessions, workouts } from "@shared/schema";
import type { User, PublicUser, Session, Workout, InsertWorkout } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, gt, lt } from "drizzle-orm";
import crypto from "node:crypto";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

// Initialize tables (SQLite create-if-not-exists — Drizzle schema is authoritative)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS workouts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    exercise TEXT NOT NULL,
    metric_value REAL NOT NULL,
    secondary_value REAL,
    unit TEXT NOT NULL,
    notes TEXT,
    performed_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_workouts_user ON workouts(user_id, performed_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

export const db = drizzle(sqlite);

export function stripPassword(u: User): PublicUser {
  const { passwordHash: _ph, ...rest } = u;
  return rest;
}

export interface IStorage {
  getUserById(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByIdentifier(identifier: string): Promise<User | undefined>;
  createUser(data: { username: string; email: string; passwordHash: string }): Promise<User>;

  createSession(userId: number, ttlMs: number): Promise<Session>;
  getSession(id: string): Promise<Session | undefined>;
  deleteSession(id: string): Promise<void>;
  deleteUserSessions(userId: number): Promise<void>;
  purgeExpiredSessions(): Promise<void>;

  createWorkout(userId: number, data: InsertWorkout): Promise<Workout>;
  listWorkouts(userId: number, limit?: number): Promise<Workout[]>;
  listWorkoutsByExercise(userId: number, exercise: string): Promise<Workout[]>;
  deleteWorkout(userId: number, id: number): Promise<boolean>;
}

export class SQLiteStorage implements IStorage {
  async getUserById(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username.toLowerCase())).get();
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.email, email.toLowerCase())).get();
  }

  async getUserByIdentifier(identifier: string): Promise<User | undefined> {
    const v = identifier.toLowerCase();
    const byEmail = await this.getUserByEmail(v);
    if (byEmail) return byEmail;
    return this.getUserByUsername(v);
  }

  async createUser(data: { username: string; email: string; passwordHash: string }): Promise<User> {
    return db
      .insert(users)
      .values({
        username: data.username.toLowerCase(),
        email: data.email.toLowerCase(),
        passwordHash: data.passwordHash,
        createdAt: Date.now(),
      })
      .returning()
      .get();
  }

  async createSession(userId: number, ttlMs: number): Promise<Session> {
    const id = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    return db
      .insert(sessions)
      .values({
        id,
        userId,
        expiresAt: now + ttlMs,
        createdAt: now,
      })
      .returning()
      .get();
  }

  async getSession(id: string): Promise<Session | undefined> {
    const s = db
      .select()
      .from(sessions)
      .where(and(eq(sessions.id, id), gt(sessions.expiresAt, Date.now())))
      .get();
    return s;
  }

  async deleteSession(id: string): Promise<void> {
    db.delete(sessions).where(eq(sessions.id, id)).run();
  }

  async deleteUserSessions(userId: number): Promise<void> {
    db.delete(sessions).where(eq(sessions.userId, userId)).run();
  }

  async purgeExpiredSessions(): Promise<void> {
    db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
  }

  async createWorkout(userId: number, data: InsertWorkout): Promise<Workout> {
    const now = Date.now();
    return db
      .insert(workouts)
      .values({
        userId,
        category: data.category,
        exercise: data.exercise.trim(),
        metricValue: data.metricValue,
        secondaryValue: data.secondaryValue ?? null,
        unit: data.unit,
        notes: data.notes ?? null,
        performedAt: data.performedAt ?? now,
        createdAt: now,
      })
      .returning()
      .get();
  }

  async listWorkouts(userId: number, limit = 500): Promise<Workout[]> {
    return db
      .select()
      .from(workouts)
      .where(eq(workouts.userId, userId))
      .orderBy(desc(workouts.performedAt))
      .limit(limit)
      .all();
  }

  async listWorkoutsByExercise(userId: number, exercise: string): Promise<Workout[]> {
    return db
      .select()
      .from(workouts)
      .where(and(eq(workouts.userId, userId), eq(workouts.exercise, exercise)))
      .orderBy(desc(workouts.performedAt))
      .all();
  }

  async deleteWorkout(userId: number, id: number): Promise<boolean> {
    const result = db
      .delete(workouts)
      .where(and(eq(workouts.id, id), eq(workouts.userId, userId)))
      .run();
    return result.changes > 0;
  }
}

export const storage = new SQLiteStorage();

// Periodically clean expired sessions
setInterval(() => storage.purgeExpiredSessions().catch(() => {}), 60 * 60 * 1000);
