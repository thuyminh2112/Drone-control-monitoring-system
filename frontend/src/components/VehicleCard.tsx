// Simple quadcopter frame glyph (center body, 4 arms, 4 rotors) - matches
// this project's actual SITL configuration (ArduCopter's default "quad" X
// frame), not a decorative stand-in for an unknown vehicle type.
function QuadIcon({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true">
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

export function VehicleCard({ iconSize = 126 }: { iconSize?: number }) {
  return (
    <div className="card vehicle-card">
      <div className="vehicle-name">vehicle-1</div>
      <div className="vehicle-frame-icon">
        <QuadIcon size={iconSize} />
      </div>
      <div className="vehicle-type">ArduCopter SITL · Quad</div>
    </div>
  );
}
