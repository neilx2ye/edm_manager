/**
 * Next.js 进程内启动钩子：在同一 Node 进程中挂载 WebSocket 实时网关
 * （独立端口）并启动 lint/截图后台任务队列。
 * 与 PROJECT_PLAN 的「同进程部署」保持一致，不引入跨进程消息总线。
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // 动态导入：避免 Next dev 在非 Node 运行时对 pg 等 Node 模块做静态打包
    const { createServer } = await import("node:http");
    const { realtimeGateway } = await import("./ws/gateway");
    const { taskQueue } = await import("./lib/queue");
    const { appPool, servicePool } = await import("./db/pools");

    const wsPort = Number(process.env.WS_PORT || 3001);
    const wsHost = process.env.WS_HOST || "0.0.0.0";
    const server = createServer((req, res) => {
      res.writeHead(404).end("EDM realtime gateway");
    });

    await realtimeGateway.attach(server);
    taskQueue.start();

    server.listen(wsPort, wsHost, () => {
      console.log(`[ws] 实时网关监听 ws://${wsHost}:${wsPort}`);
    });

    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`[ws] 收到 ${signal}，优雅退出…`);
      taskQueue.stop();
      await realtimeGateway.close();
      server.close(async () => {
        await Promise.allSettled([appPool.end(), servicePool.end()]);
        process.exit(0);
      });
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  }
}
