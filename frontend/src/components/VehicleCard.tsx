// Simple quadcopter frame glyph (center body, 4 arms, 4 rotors) - matches
// this project's actual SITL configuration (ArduCopter's default "quad" X
// frame), not a decorative stand-in for an unknown vehicle type.
function QuadIcon() {
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <line x1="24" y1="24" x2="9" y2="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="24" y1="24" x2="39" y2="9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="24" y1="24" x2="9" y2="39" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <line x1="24" y1="24" x2="39" y2="39" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="9" cy="9" r="5.5" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <circle cx="39" cy="9" r="5.5" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <circle cx="9" cy="39" r="5.5" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <circle cx="39" cy="39" r="5.5" stroke="currentColor" strokeWidth="2.5" fill="none" />
      <rect x="20" y="20" width="8" height="8" rx="2" fill="currentColor" />
    </svg>
  );
}

export function VehicleCard() {
  return (
    <div className="card vehicle-card">
      <div className="vehicle-card-info">
        <div className="metric-label">Vehicle</div>
        <div className="vehicle-name">vehicle-1</div>
        <div className="vehicle-type">ArduCopter SITL · Quad</div>
      </div>
      <div className="vehicle-frame-icon">
        <QuadIcon />
      </div>
    </div>
  );
}
