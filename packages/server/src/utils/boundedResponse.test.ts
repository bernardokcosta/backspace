import { describe, it, expect, vi } from 'vitest';
import { readBoundedResponse } from './boundedResponse.js';

describe('bounded federation response', () => {
  it('reads exactly the byte budget', async () => {
    expect(await readBoundedResponse(new Response('1234'), 4)).toEqual(Buffer.from('1234'));
  });
  it.each([true, false])('cancels an oversized body (announced=%s)', async announced => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(8)); }, cancel,
    }), { headers: announced ? { 'content-length': '8' } : {} });
    await expect(readBoundedResponse(response, 4)).rejects.toThrow(/limit/);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });
});
