import type { WsStatus } from "../types/telemetry";
import { StatusBadge } from "./StatusBadge";

export function Header({ connected, wsStatus }: { connected: boolean; wsStatus: WsStatus }) {
  const tone = wsStatus !== "open" ? "warn" : connected ? "good" : "bad";
  const label =
    wsStatus !== "open" ? "Link reconnecting…" : connected ? "Vehicle connected" : "Vehicle disconnected";

  return (
    <header className="app-header">
      <div>
        <h1>SAR Mission Control</h1>
        <div className="subtitle">Search &amp; rescue sortie — vehicle-1 (ArduCopter SITL)</div>
      </div>
      <StatusBadge tone={tone} label={label} />
    </header>
  );
}
