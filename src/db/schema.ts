import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const auth = pgSchema("auth");
const edm = pgSchema("edm");

// ---------------------------------------------------------------------------
// auth（Auth.js adapter）
// ---------------------------------------------------------------------------

export const users = auth.table("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  // 数据库列为 citext（大小写不敏感）；drizzle 侧以 text 建模以兼容 adapter 类型
  email: text("email").notNull().unique(),
  emailVerified: timestamp("emailVerified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  passwordHash: text("password_hash"),
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  role: text("role", { enum: ["admin", "member"] }).notNull().default("member"),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const sessions = auth.table("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionToken: text("sessionToken").notNull().unique(),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updatedAt", { withTimezone: true, mode: "date" })
    .notNull()
    .defaultNow(),
});

export const accounts = auth.table("accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: uuid("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const verificationTokens = auth.table(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => ({ compositePk: primaryKey({ columns: [t.identifier, t.token] }) }),
);

// ---------------------------------------------------------------------------
// edm 业务表
// ---------------------------------------------------------------------------

export const projects = edm.table(
  "projects",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    name: text("name").notNull(),
    description: text("description"),
    ownerId: uuid("owner_id").notNull(),
    agentCanApprove: boolean("agent_can_approve").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("projects_owner_idx").on(t.ownerId)],
);

export const projectMembers = edm.table(
  "project_members",
  {
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    invitedBy: uuid("invited_by"),
    joinedAt: timestamp("joined_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.userId] }),
    index("project_members_user_idx").on(t.userId),
  ],
);

export const topics = edm.table(
  "topics",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    purpose: text("purpose"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("topics_project_idx").on(t.projectId)],
);

export const templates = edm.table(
  "templates",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    topicId: bigint("topic_id", { mode: "number" })
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    purpose: text("purpose"),
    tags: text("tags").array().notNull().default([]),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdBy: uuid("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("templates_topic_idx").on(t.topicId)],
);

export const projectApiKeys = edm.table(
  "project_api_keys",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    role: text("role", { enum: ["agent"] }).notNull().default("agent"),
    createdBy: uuid("created_by"),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true, mode: "date" }),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("project_api_keys_project_idx").on(t.projectId)],
);

export const versions = edm.table(
  "versions",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    templateId: bigint("template_id", { mode: "number" })
      .notNull()
      .references(() => templates.id, { onDelete: "cascade" }),
    html: text("html").notNull(),
    source: text("source"),
    note: text("note"),
    status: text("status", { enum: ["draft", "saved"] })
      .notNull()
      .default("draft"),
    lintReport: jsonb("lint_report").$type<LintIssue[]>().notNull().default([]),
    screenshotPath: text("screenshot_path"),
    createdBy: uuid("created_by"),
    sourceApiKeyId: bigint("source_api_key_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("versions_template_created_idx").on(t.templateId, t.createdAt),
    index("versions_created_by_idx").on(t.createdBy),
  ],
);

export const images = edm.table(
  "images",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint("project_id", { mode: "number" })
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    storagePath: text("storage_path").notNull(),
    createdBy: uuid("created_by"),
    sourceApiKeyId: bigint("source_api_key_id", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("images_project_created_idx").on(t.projectId, t.createdAt)],
);

export const versionJobs = edm.table(
  "version_jobs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    versionId: bigint("version_id", { mode: "number" })
      .notNull()
      .references(() => versions.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["lint", "screenshot"] }).notNull(),
    status: text("status", {
      enum: ["pending", "running", "done", "failed"],
    })
      .notNull()
      .default("pending"),
    result: jsonb("result"),
    error: text("error"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" }),
    finishedAt: timestamp("finished_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("version_jobs_status_idx").on(t.status, t.id),
    index("version_jobs_version_idx").on(t.versionId),
  ],
);

export const auditLogs = edm.table(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    projectId: bigint("project_id", { mode: "number" }).references(
      () => projects.id,
      { onDelete: "cascade" },
    ),
    actorId: uuid("actor_id"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: bigint("entity_id", { mode: "number" }),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("audit_logs_project_created_idx").on(t.projectId, t.createdAt)],
);

export interface LintIssue {
  rule: string;
  severity: "warn" | "error" | "info";
  message: string;
  detail?: string;
}

// Auth.js adapter 需要的 schema 视图
export const authSchema = {
  usersTable: users,
  accountsTable: accounts,
  sessionsTable: sessions,
  verificationTokensTable: verificationTokens,
};
