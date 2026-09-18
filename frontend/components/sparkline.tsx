export function Sparkline({
  values,
  className = "",
}: {
  values: number[];
  className?: string;
}) {
  if (values.length < 2) {
    return <div className={`h-8 ${className}`} />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * 100;
      const y = 18 - ((v - min) / span) * 16;
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg viewBox="0 0 100 20" className={`h-8 w-full ${className}`} preserveAspectRatio="none">
      <polyline
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        points={points}
      />
    </svg>
  );
}
