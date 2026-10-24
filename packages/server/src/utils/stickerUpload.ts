import { Transform, type TransformCallback } from 'node:stream';
import type { preParsingAsyncHookHandler } from 'fastify';

export const MAX_STICKER_JSON_BYTES = 500 * 1024 * 1024;

/** Route-specific dynamic budget, enforced before the JSON parser, not by a
 * client-supplied header. Authentication belongs in onRequest, ahead of this. */
export function stickerUploadBodyLimit(getMaxBytes: () => number): preParsingAsyncHookHandler {
  return async (_request, _reply, payload) => {
    const budget = Math.min(MAX_STICKER_JSON_BYTES, Math.ceil(getMaxBytes() / 3) * 4 + 4096);
    class LimitedBody extends Transform {
      receivedEncodedLength = 0;
      override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
        this.receivedEncodedLength += chunk.length;
        if (this.receivedEncodedLength > budget) {
          done(Object.assign(new Error('Request body is too large'), { statusCode: 413, code: 'FST_ERR_CTP_BODY_TOO_LARGE' }));
        } else {
          done(null, chunk);
        }
      }
    }
    const limited = new LimitedBody();
    const onError = (error: Error) => limited.destroy(error);
    payload.once('error', onError);
    limited.once('close', () => {
      payload.unpipe(limited);
      payload.removeListener('error', onError);
    });
    return payload.pipe(limited);
  };
}
