let lastActionAt = 0;

export async function paceWrite(): Promise<void> {
  const minimum = Math.max(1000, Number(process.env.NEXTDOOR_MIN_WRITE_INTERVAL_MS || 3000));
  const wait = minimum - (Date.now() - lastActionAt);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  lastActionAt = Date.now();
}
