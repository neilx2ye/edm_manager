/** 前后端共享类型（与 API 响应字段一一对应）。 */

/** 系统级角色：管理员 / 非管理员。管理员唯一特权 = 管理用户。 */
export type Role = "admin" | "member";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  mustChangePassword: boolean;
  role: Role;
}

export interface Project {
  id: number;
  name: string;
  description: string | null;
  ownerId: string;
  agentCanApprove: boolean;
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
  templateCount: number;
  topicCount: number;
}

export interface ProjectMember {
  userId: string;
  joinedAt: string;
  email: string;
  name: string | null;
  mustChangePassword: boolean;
}

export interface UserMembership {
  projectId: number;
  projectName: string;
}

/** 全局用户管理：账号 + 系统角色 + 其在各项目中的成员资格。 */
export interface UserAccount {
  id: string;
  email: string;
  name: string | null;
  role: Role;
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
  /** 上传接口返回：内容与项目内已有图片相同，直接复用（未新建记录）。 */
  deduplicated?: boolean;
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
