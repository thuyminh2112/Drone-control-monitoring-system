export function FlightModeBadge({ mode }: { mode: string }) {
  return (
    <div className="card">
      <div className="metric-label">Flight mode</div>
      <div className="metric-value">{mode}</div>
    </div>
  );
}
