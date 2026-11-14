import { pgTable, serial, integer, text, bigint, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").default("Developer"),
  passcodePin: text("passcode_pin").default("1234"),
  saasPlan: text("saas_plan").default("free"),
  transcribeCount: integer("transcribe_count").default(0),
});

export const transcriptionHistory = pgTable("transcription_history", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  timestamp: text("timestamp"),
  fileName: text("file_name"),
  fileSize: text("file_size"),
  duration: text("duration"),
  rawText: text("raw_text"),
  parsed: jsonb("parsed"),
  instruction: text("instruction"),
  mode: text("mode"),
});

export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  token: text("token").notNull(),
  status: text("status").default("active"),
  createdAt: text("created_at"),
});

export const teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  role: text("role").default("Developer"),
  joinedAt: text("joined_at"),
});

export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  email: text("email").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
});

export const adminSettings = pgTable("admin_settings", {
  id: integer("id").primaryKey(),
  smtpHost: text("smtp_host"),
  smtpPort: text("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  smtpFrom: text("smtp_from"),
  geminiApiKey: text("gemini_api_key"),
});
