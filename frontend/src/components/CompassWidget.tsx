const TICKS = Array.from({ length: 36 }, (_, i) => i * 10);
const CARDINALS: { label: string; angle: number }[] = [
  { label: "N", angle: 0 },
  { label: "E", angle: 90 },
  { label: "S", angle: 180 },
  { label: "W", angle: 270 },
];

function polar(angleDeg: number, radius: number, cx = 50, cy = 50) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
}

// QGroundControl-style compass: a fixed N/E/S/W ring (North always up) with
// the vehicle drawn as a rotating chevron at the center pointing along the
// current heading — same shape as the map marker, recolored into a
// glowing cyan "instrument" palette instead of the marker's orange.
export function CompassWidget({
  heading,
  size = 92,
  standalone = false,
}: {
  heading: number | null;
  size?: number;
  standalone?: boolean;
}) {
  const hdg = heading ?? 0;

  return (
    <div className={standalone ? "compass-widget compass-standalone" : "compass-widget"}>
      <svg viewBox="0 0 100 100" width={size} height={size}>
        <defs>
          <radialGradient id="compassFace" cx="50%" cy="42%" r="65%">
            <stop offset="0%" stopColor="#132b3d" />
            <stop offset="100%" stopColor="#050a10" />
          </radialGradient>
          <linearGradient id="compassNeedle" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#8fffe8" />
            <stop offset="55%" stopColor="#37c8ff" />
            <stop offset="100%" stopColor="#1a6fbf" />
          </linearGradient>
          <filter id="compassGlow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <circle cx="50" cy="50" r="47" fill="url(#compassFace)" stroke="#2fa9d6" strokeWidth="1" opacity="0.95" />
        <circle cx="50" cy="50" r="47" fill="none" stroke="#7be6ff" strokeWidth="0.6" opacity="0.4" />
        <circle cx="50" cy="50" r="38" fill="none" stroke="#2a5972" strokeWidth="0.5" opacity="0.6" />

        {TICKS.map((angle) => {
          const major = angle % 90 === 0;
          const mid = !major && angle % 30 === 0;
          const len = major ? 9 : mid ? 6 : 3;
          const p1 = polar(angle, 46);
          const p2 = polar(angle, 46 - len);
          return (
            <line
              key={angle}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={major ? "#8fffe8" : "#3ba9c9"}
              strokeWidth={major ? 1.3 : 0.6}
              opacity={major ? 0.95 : 0.5}
            />
          );
        })}

        {CARDINALS.map(({ label, angle }) => {
          const p = polar(angle, 36);
          return (
            <text
              key={label}
              x={p.x}
              y={p.y + 2.5}
              textAnchor="middle"
              fontSize={label === "N" ? 9 : 7}
              fontWeight={label === "N" ? 700 : 500}
              fill={label === "N" ? "#8fffe8" : "#8fb9c9"}
            >
              {label}
            </text>
          );
        })}

        <g style={{ transition: "transform 0.15s linear" }} transform={`rotate(${hdg} 50 50)`}>
          <path
            d="M50 20 L61.5 70 L50 59 L38.5 70 Z"
            fill="url(#compassNeedle)"
            stroke="#eafeff"
            strokeWidth="1"
            strokeLinejoin="round"
            filter="url(#compassGlow)"
          />
        </g>

        <circle cx="50" cy="50" r="2.2" fill="#eafeff" opacity="0.9" />
      </svg>
      <div className="compass-heading">{Math.round(hdg)}°</div>
    </div>
  );
}
