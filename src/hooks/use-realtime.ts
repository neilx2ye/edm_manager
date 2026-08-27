"use client";

import { useEffect, useRef } from "react";
import type { WsEvent } from "@/lib/types";

/**
 * 订阅项目实时事件（WS 网关）。
 * 默认走同源 `/ws` 路径（由 Caddy 反向代理到 WS 网关）；本地开发可用
 * NEXT_PUBLIC_WS_URL 覆盖。
 * 自动重连；projectId 为空时不连接。
 */
export function useRealtime(
  projectId: number | null,
  onEvent: (event: WsEvent) => void,
) {
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!projectId) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const url = () => {
      const base =
        process.env.NEXT_PUBLIC_WS_URL ??
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`;
      return `${base}?projectId=${projectId}`;
    };

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(url());
      ws.onopen = () => {
        retry = 0;
      };
      ws.onmessage = (e) => {
        try {
          const event = JSON.parse(String(e.data)) as WsEvent;
          handlerRef.current(event);
        } catch {
          // 忽略无法解析的消息
        }
      };
      ws.onclose = () => {
        if (closed) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(1000 * retry, 5000));
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [projectId]);
}
