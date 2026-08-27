/** 前后端共享类型（与 API 响应字段一一对应）。 */

export type Role = "owner" | "admin" | "editor" | "viewer";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  ownerId: string;
  agentCanApprove: boolean;
  createdAt: string;
  updatedAt: string;
  myRole: Role;
  templateCount: number;
  topicCount: number;
}

export interface ProjectMember {
  userId: string;
  role: Role;
  joinedAt: string;
  email: string;
  name: string | null;
  mustChangePassword: boolean;
}

export interface UserMembership {
  projectId: number;
  projectName: string;
  role: Role;
}

/** 全局用户管理：账号 + 其在各项目中的成员资格。 */
export interface UserAccount {
  id: string;
  email: string;
  name: string | null;
  mustChangePassword: boolean;
  createdAt: string;
  memberships: UserMembership[];
}

export interface LintIssue {
  rule: string;
  severity: "warn" | "error" | "info";
  message: string;
  detail?: string;
}

export interface TemplateSummary {
  id: number;
  topicId: number;
  projectId: number;
  topicName: string;
  name: string;
  purpose: string | null;
  tags: string[];
  status: "active" | "archived";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  latestVersionId: number | null;
  latestStatus: "draft" | "saved" | null;
  latestVersionAt: string | null;
  screenshotPath: string | null;
  lintReport: LintIssue[];
}

export interface TemplateDetail extends TemplateSummary {
  projectName: string;
  agentCanApprove: boolean;
}

export interface Topic {
  id: number;
  projectId: number;
  name: string;
  purpose: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  templateCount: number;
}

export type JobKind = "lint" | "screenshot";
export type JobStatus = "pending" | "running" | "done" | "failed";

export interface VersionJob {
  id: number;
  kind: JobKind;
  status: JobStatus;
  result: unknown | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Version {
  id: number;
  templateId: number;
  html: string;
  source: string | null;
  note: string | null;
  status: "draft" | "saved";
  lintReport: LintIssue[];
  screenshotPath: string | null;
  createdBy: string | null;
  sourceApiKeyId: number | null;
  createdAt: string;
  jobs: VersionJob[];
}

export interface ApiKeyInfo {
  id: number;
  name: string;
  role: string;
  createdBy: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  key?: string;
}

export interface Image {
  id: number;
  projectId: number;
  name: string;
  contentType: string;
  sizeBytes: number;
  createdBy: string | null;
  sourceApiKeyId: number | null;
  createdAt: string;
  createdByEmail: string | null;
  createdByName: string | null;
  url: string;
}

export type WsEvent =
  | { type: "subscribed"; projectId: number }
  | {
      type: "version";
      versionId: number;
      templateId: number;
      projectId: number;
      status: string;
    }
  | {
      type: "job";
      jobId: number;
      versionId: number;
      kind: JobKind;
      status: JobStatus;
      projectId: number;
    };
