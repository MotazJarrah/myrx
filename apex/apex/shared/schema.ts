import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ─── USERS ──────────────────────────────────────────────────────────────
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  email: true,
});

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(32, "Username must be at most 32 characters")
    .regex(/^[a-zA-Z0-9_]+$/, "Username can only contain letters, numbers, and underscores"),
  email: z.string().email("Invalid email address").max(254),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password must be at most 128 characters"),
});

export const loginSchema = z.object({
  identifier: z.string().min(1, "Username or email is required"),
  password: z.string().min(1, "Password is required"),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type PublicUser = Omit<User, "passwordHash">;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// ─── SESSIONS (server-side) ─────────────────────────────────────────────
export const sessions = sqliteTable("sessions", {
  id: text("id").primaryKey(), // random token
  userId: integer("user_id").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type Session = typeof sessions.$inferSelect;

// ─── WORKOUT ENTRIES ────────────────────────────────────────────────────
// Unified log across categories. One row = one recorded effort.
// category: strength | cardio | bodyweight
// For strength:    metricValue = weight, reps = reps performed, unit = lbs|kg
// For cardio:      metricValue = distance, secondaryValue = time(seconds), unit = m|km|mi
// For bodyweight:  metricValue = reps, unit = reps
export const workouts = sqliteTable("workouts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  category: text("category").notNull(), // strength | cardio | bodyweight
  exercise: text("exercise").notNull(), // "Bench Press", "Rowing", "Pull-ups"
  metricValue: real("metric_value").notNull(), // weight | distance | reps
  secondaryValue: real("secondary_value"), // reps (strength) | duration seconds (cardio)
  unit: text("unit").notNull(), // lbs | kg | m | km | mi | reps
  notes: text("notes"),
  performedAt: integer("performed_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const insertWorkoutSchema = z.object({
  category: z.enum(["strength", "cardio", "bodyweight"]),
  exercise: z.string().min(1, "Exercise is required").max(64),
  metricValue: z.number().positive("Must be a positive number").finite(),
  secondaryValue: z.number().positive().finite().optional().nullable(),
  unit: z.string().min(1).max(8),
  notes: z.string().max(500).optional().nullable(),
  performedAt: z.number().int().positive().optional(),
});

export type InsertWorkout = z.infer<typeof insertWorkoutSchema>;
export type Workout = typeof workouts.$inferSelect;
