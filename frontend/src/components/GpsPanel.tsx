function fmt(value: number | null, digits = 6): string {
  return value === null ? "—" : value.toFixed(digits);
}

export function GpsPanel({ lat, lon }: { lat: number | null; lon: number | null }) {
  return (
    <div className="card">
      <div className="metric-label">Position</div>
      <div className="metric-value small">Lat {fmt(lat)}</div>
      <div className="metric-value small">Lon {fmt(lon)}</div>
    </div>
  );
}
