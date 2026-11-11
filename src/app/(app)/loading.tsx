export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading" className="animate-pulse space-y-6">
      <div className="h-3 w-24 rounded bg-raised" />
      <div className="h-7 w-64 rounded bg-raised" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-line bg-panel" />
        ))}
      </div>
      <div className="h-64 rounded-xl border border-line bg-panel" />
    </div>
  );
}
