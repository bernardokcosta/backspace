/**
 * The `TRUSTED_PROXY_HOPS` count as a Fastify `trustProxy` function.
 *
 * Fastify 5 removed the numeric `trustProxy` option: a number now fails
 * closed and trusts nothing (see `getTrustProxyFn` in fastify's
 * `lib/request.js`). The count is therefore expressed as a function with the
 * identical proxy-addr hop semantics the number used to carry: while walking
 * outward from the socket, the first `hops` entries are trusted and the walk
 * stops at the first untrusted one, whose address becomes `request.ip`.
 *
 * Both `index.ts` and the address tests build their Fastify instances from
 * this helper so production and the rate-limit keying tests cannot drift
 * apart. `hops` is already validated (non-negative integer, capped) by
 * `config.ts`, so this function takes it at face value.
 */
export function trustProxyFn(hops: number): (address: string, hop: number) => boolean {
  return (_address: string, hop: number) => hop < hops;
}
