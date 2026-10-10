const ROWS = 9;
const SHIMMER = "block h-3 animate-shimmer bg-[linear-gradient(90deg,#F4F0EB_25%,#FBF9F6_50%,#F4F0EB_75%)] bg-[length:200%_100%]";

// Grey shimmering rows while a list loads
export default function SkeletonRows() {
  return (
    <div aria-label="Loading">
      {Array.from({ length: ROWS }, (_, i) => (
        <div key={i} className="grid grid-cols-[40px_1fr_80px_60px] items-center gap-3 border-b border-line px-6.5 py-4">
          <i className={`${SHIMMER} h-5.5`} />
          <i className={SHIMMER} />
          <i className={SHIMMER} />
          <i className={`${SHIMMER} h-5.5`} />
        </div>
      ))}
    </div>
  );
}
