/** A labelled figure. Render several inside a <dl> grid (see StatGrid). */
export function StatCard({
  label,
  value,
  testId,
  note,
}: {
  label: string;
  value: string;
  testId: string;
  note?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <dt className="text-sm text-gray-600">{label}</dt>
      <dd data-testid={testId} className="mt-1 text-3xl font-semibold tabular-nums tracking-tight">
        {value}
      </dd>
      {note && <p className="mt-1 text-xs text-gray-600">{note}</p>}
    </div>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</dl>;
}
