import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  salt: text("salt").notNull(),
  passwordHash: text("password_hash").notNull(),
  totpSecret: text("totp_secret").notNull(),
  lastTotpStep: integer("last_totp_step").notNull().default(-1),
  role: text("role").notNull(),
  status: text("status").notNull(),
  mustChangePassword: integer("must_change_password").notNull().default(1),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("idx_users_username").on(table.username)]);

export const sessions = sqliteTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const ipAllowlist = sqliteTable("ip_allowlist", {
  address: text("address").primaryKey(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const loginAttempts = sqliteTable("login_attempts", {
  key: text("key").primaryKey(),
  failures: integer("failures").notNull(),
  windowStart: integer("window_start").notNull(),
});

export const reports = sqliteTable("reports", {
  id: text("id").primaryKey(),
  description: text("description").notNull(),
  taxYear: integer("tax_year").notNull(),
  fromMonth: integer("from_month").notNull(),
  toMonth: integer("to_month").notNull(),
  filename: text("filename").notNull(),
  rowsJson: text("rows_json").notNull(),
  hidden: integer("hidden").notNull().default(0),
  createdBy: text("created_by").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_reports_period_description").on(table.taxYear, table.fromMonth, table.toMonth, table.description)]);
