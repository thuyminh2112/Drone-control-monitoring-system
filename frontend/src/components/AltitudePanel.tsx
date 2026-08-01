export function AltitudePanel({ altRelative, groundspeed }: { altRelative: number | null; groundspeed: number | null }) {
  return (
    <div className="card">
      <div className="metric-label">Altitude (AGL)</div>
      <div className="metric-value">{altRelative === null ? "—" : `${altRelative.toFixed(1)} m`}</div>
      {groundspeed !== null && (
        <div className="metric-value small" style={{ marginTop: 8 }}>
          {groundspeed.toFixed(1)} m/s ground speed
        </div>
      )}
    </div>
  );
}
