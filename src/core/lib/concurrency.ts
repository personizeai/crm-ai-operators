// -----------------------------------------------------------------------------
// runWithConcurrency — bounded worker pool over an item list.
//
// Why not bare Promise.allSettled: with 50 eligible records, allSettled fires
// 50 concurrent operations at once — each making multiple SDK calls — which can
// rate-limit the whole org from a single route config. A bounded pool keeps
// throughput high while capping simultaneous in-flight work.
//
// Semantics match Promise.allSettled: results are in input order, one
// PromiseSettledResult per item, and the call itself never rejects.
// -----------------------------------------------------------------------------

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  if (items.length === 0) return results;

  const poolSize = Math.max(1, Math.min(Math.floor(limit), items.length));
  let next = 0;

  const workers = Array.from({ length: poolSize }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      try {
        results[i] = { status: "fulfilled", value: await fn(items[i], i) };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  });

  await Promise.all(workers);
  return results;
}
