/** Bound decompressed bytes, even when Content-Length is absent or dishonest.
 * Always cancel an abandoned body: releasing a reader does not stop fetching. */
export async function readBoundedResponse(response: Response, budget: number): Promise<Buffer> {
  if (Number(response.headers.get('content-length')) > budget) {
    await response.body?.cancel();
    throw new Error('Response exceeds the local size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Response has no readable body');
  const chunks: Buffer[] = [];
  let total = 0;
  let finished = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { finished = true; break; }
      total += value.byteLength;
      if (total > budget) throw new Error('Response exceeds the local size limit');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    if (!finished) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
