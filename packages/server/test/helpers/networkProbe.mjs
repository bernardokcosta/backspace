import { appendFileSync } from 'node:fs';
import dns from 'node:dns';
import net from 'node:net';

// Child-only test instrumentation: count attempts, never record URLs or payloads.
const mark = kind => appendFileSync(process.env.TEST_NETWORK_PROBE_PATH, `${kind}\n`);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) { mark('tcp'); return Reflect.apply(connect, this, args); };
const lookup = dns.lookup;
dns.lookup = function (...args) { mark('dns'); return Reflect.apply(lookup, this, args); };
for (const key of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
  const original = dns.promises[key];
  dns.promises[key] = function (...args) { mark('dns'); return Reflect.apply(original, this, args); };
}
