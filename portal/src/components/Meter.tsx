// How much of an area's shade data is ready
export default function Meter({ done, total, className = "" }) {
  return (
    <div className={`h-1.5 bg-shade/20 ${className}`}>
      <i className="block h-full bg-shade transition-[width] duration-600" style={{ width: `${(100 * done) / (total || 1)}%` }} />
    </div>
  );
}
