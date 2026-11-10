export function StatusBadge({ status, testId }: { status: "COMPLETED" | "CANCELLED"; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-block rounded px-2 py-0.5 text-xs font-semibold ${
        status === "CANCELLED" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"
      }`}
    >
      {status}
    </span>
  );
}
