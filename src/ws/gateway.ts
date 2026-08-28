import type { IncomingMessage, Server } from "node:http";
import type { PoolClient } from "pg";
import { WebSocket, WebSocketServer } from "ws";
import { servicePool } from "@/db/pools";
import { checkMembership } from "@/db/context";
import { resolveSessionToken } from "@/lib/auth-helpers";

interface Subscriber {
  ws: WebSocket;
  userId: string;
  projectId: number;
  alive: boolean;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = req.headers.cookie ?? "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

const COOKIE_NAMES = ["__Secure-authjs.session-token", "authjs.session-token"];

function extractSessionToken(req: IncomingMessage): string | null {
  const cookies = parseCookies(req);
  for (const name of COOKIE_NAMES) {
    if (cookies[name]) return cookies[name];
  }
  return null;
}

export class RealtimeGateway {
  private wss: WebSocketServer | null = null;
  private listeners: (() => void)[] = [];
  private subscribers = new Set<Subscriber>();
  private client: PoolClient | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

  async attach(server: Server): Promise<void> {
    console.log("[ws] attach 开始");
    this.wss = new WebSocketServer({ noServer: true });

    server.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname !== "/ws") {
        socket.destroy();
        return;
      }
      this.wss?.handleUpgrade(req, socket, head, (ws) => {
        void this.handleConnection(req, ws);
      });
    });

    console.log("[ws] WSS 就绪，启动 LISTEN");
    await this.startListener();

    this.heartbeat = setInterval(() => {
      for (const sub of this.subscribers) {
        if (!sub.alive) {
          sub.ws.terminate();
          this.subscribers.delete(sub);
          continue;
        }
        sub.alive = false;
        sub.ws.ping();
      }
    }, 30_000);
  }

  private async handleConnection(req: IncomingMessage, ws: WebSocket): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    const projectId = Number(url.searchParams.get("projectId"));
    if (!Number.isInteger(projectId) || projectId <= 0) {
      ws.close(1008, "invalid projectId");
      return;
    }

    const token = extractSessionToken(req);
    if (!token) {
      ws.close(1008, "unauthorized");
      return;
    }
    const cookieName = parseCookies(req)["__Secure-authjs.session-token"]
      ? "__Secure-authjs.session-token"
      : "authjs.session-token";
    const session = await resolveSessionToken(token, cookieName);
    if (!session) {
      ws.close(1008, "unauthorized");
      return;
    }
    const ok = await checkMembership(session.userId, projectId);
    if (!ok) {
      ws.close(1003, "forbidden");
      return;
    }

    const sub: Subscriber = {
      ws,
      userId: session.userId,
      projectId,
      alive: true,
    };
    this.subscribers.add(sub);
    ws.send(JSON.stringify({ type: "subscribed", projectId }));

    ws.on("pong", () => {
      sub.alive = true;
    });
    ws.on("close", () => {
      this.subscribers.delete(sub);
    });
    ws.on("error", () => {
      this.subscribers.delete(sub);
    });
  }

  private async startListener(): Promise<void> {
    console.log("[ws] 连接 service pool…");
    const client = await servicePool.connect();
    console.log("[ws] LISTEN 连接建立");
    this.client = client;
    client.on("notification", (msg) => {
      void this.onNotification(msg.channel, msg.payload);
    });
    client.on("error", (err) => {
      console.error("[ws] LISTEN 连接错误:", err.message);
    });
    await client.query('LISTEN "edm.version_events"');
    await client.query('LISTEN "edm.task_events"');
    console.log("[ws] 已订阅 LISTEN edm.version_events / edm.task_events");
  }

  private async onNotification(channel: string, payload: string | undefined): Promise<void> {
    if (!payload) return;
    let data: { id?: number } = {};
    try {
      data = JSON.parse(payload);
    } catch {
      return;
    }
    if (!data.id) return;

    try {
      if (channel === "edm.version_events") {
        await this.forwardVersion(Number(data.id));
      } else {
        await this.forwardJob(Number(data.id));
      }
    } catch (err) {
      console.error("[ws] 事件转发失败:", err);
    }
  }

  private async forwardVersion(versionId: number): Promise<void> {
    const row = await this.loadVersion(versionId);
    if (!row) return;
    await this.broadcastToProject(Number(row.project_id), {
      type: "version",
      versionId,
      templateId: Number(row.template_id),
      projectId: Number(row.project_id),
      status: row.status,
    });
  }

  private async forwardJob(jobId: number): Promise<void> {
    const res = await servicePool.query(
      `SELECT j.id, j.version_id, j.kind, j.status,
              tp.project_id AS project_id
         FROM edm.version_jobs j
         JOIN edm.versions v ON v.id = j.version_id
         JOIN edm.templates t ON t.id = v.template_id
         JOIN edm.topics tp ON tp.id = t.topic_id
        WHERE j.id = $1`,
      [jobId],
    );
    const row = res.rows[0];
    if (!row) return;
    await this.broadcastToProject(Number(row.project_id), {
      type: "job",
      jobId: Number(row.id),
      versionId: Number(row.version_id),
      kind: row.kind,
      status: row.status,
      projectId: Number(row.project_id),
    });
  }

  private async loadVersion(versionId: number) {
    const res = await servicePool.query(
      `SELECT v.id, v.status,
              tp.project_id AS project_id,
              v.template_id::bigint AS template_id
         FROM edm.versions v
         JOIN edm.templates t ON t.id = v.template_id
         JOIN edm.topics tp ON tp.id = t.topic_id
        WHERE v.id = $1`,
      [versionId],
    );
    return res.rows[0] ?? null;
  }

  /** 每次转发前在 SQL 层重新复核成员资格（成员被移除后立即断连）。 */
  private async broadcastToProject(
    projectId: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const targets = [...this.subscribers].filter(
      (s) => s.projectId === projectId,
    );
    for (const sub of targets) {
      const ok = await checkMembership(sub.userId, projectId);
      if (!ok) {
        sub.ws.close(1003, "membership revoked");
        this.subscribers.delete(sub);
        continue;
      }
      if (sub.ws.readyState === WebSocket.OPEN) {
        sub.ws.send(JSON.stringify(payload));
      }
    }
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const sub of this.subscribers) sub.ws.close(1001, "server shutdown");
    this.subscribers.clear();
    this.client?.release();
    this.client = null;
  }
}

export const realtimeGateway = new RealtimeGateway();
