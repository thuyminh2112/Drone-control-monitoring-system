type Tone = "good" | "warn" | "bad" | "neutral";

export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className={`badge ${tone}`}>
      <span className="badge-dot" />
      {label}
    </span>
  );
}
