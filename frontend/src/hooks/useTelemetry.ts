import { useEffect, useRef, useState } from "react";
import type { TelemetryState, WsStatus } from "../types/telemetry";

const MIN_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 10000;

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/telemetry`;
}

export function useTelemetry() {
  const [telemetry, setTelemetry] = useState<TelemetryState | null>(null);
  const [status, setStatus] = useState<WsStatus>("connecting");
  const backoffRef = useRef(MIN_BACKOFF_MS);
  const shouldReconnectRef = useRef(true);

  useEffect(() => {
    shouldReconnectRef.current = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      setStatus("connecting");
      socket = new WebSocket(wsUrl());

      socket.onopen = () => {
        backoffRef.current = MIN_BACKOFF_MS;
        setStatus("open");
      };

      socket.onmessage = (event) => {
        try {
          setTelemetry(JSON.parse(event.data) as TelemetryState);
        } catch {
          // ignore malformed frame
        }
      };

      socket.onclose = () => {
        setStatus("closed");
        if (!shouldReconnectRef.current) return;
        reconnectTimer = setTimeout(connect, backoffRef.current);
        backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      };

      socket.onerror = () => {
        socket?.close();
      };
    };

    connect();

    return () => {
      shouldReconnectRef.current = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, []);

  return { telemetry, status };
}
