import { StatusBadge } from "./StatusBadge";

export function ArmedIndicator({ armed }: { armed: boolean }) {
  return (
    <div className="card">
      <div className="metric-label">Arming status</div>
      <StatusBadge tone={armed ? "bad" : "neutral"} label={armed ? "Armed" : "Disarmed"} />
    </div>
  );
}
