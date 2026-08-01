export function BatteryGauge({ percent, voltage }: { percent: number | null; voltage: number | null }) {
  const pct = percent ?? 0;
  const color = pct > 30 ? "var(--color-good)" : pct > 15 ? "var(--color-warn)" : "var(--color-bad)";

  return (
    <div className="card">
      <div className="metric-label">Battery</div>
      <div className="metric-value">{percent === null ? "—" : `${percent.toFixed(0)}%`}</div>
      <div className="battery-bar">
        <div className="battery-bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} />
      </div>
      {voltage !== null && (
        <div className="metric-value small" style={{ marginTop: 8 }}>
          {voltage.toFixed(2)} V
        </div>
      )}
    </div>
  );
}
