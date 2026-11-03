const minute = 60_000;

export function processingCutoff(now: Date, intervalMinutes: number) {
  return new Date(now.getTime() - (60 + intervalMinutes) * minute);
}

export function orderSyncIssue(
  now: Date,
  intervalMinutes: number,
  state: { lastSuccessAt: Date | null; lastErrorCode: string | null } | undefined,
  connectedAt: Date,
) {
  if (state?.lastErrorCode) return "Order sync failed";
  const lastSuccess = state?.lastSuccessAt ?? connectedAt;
  // Allow one extra cycle for a scheduled sync to finish.
  return now.getTime() - lastSuccess.getTime() >= 2 * intervalMinutes * minute
    ? "Order sync is overdue"
    : null;
}
