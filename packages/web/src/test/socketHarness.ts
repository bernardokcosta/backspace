import { vi } from 'vitest';

/** A disposable signaling transport; no test opens a network socket. */
export class TestWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static all: TestWebSocket[] = [];
  readyState = TestWebSocket.CONNECTING;
  sent: Array<Record<string, unknown>> = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { TestWebSocket.all.push(this); }
  send(data: string): void { this.sent.push(JSON.parse(data) as Record<string, unknown>); }
  close(): void { this.readyState = TestWebSocket.CLOSED; }
  open(): void { this.readyState = TestWebSocket.OPEN; this.onopen?.(); }
  fail(code = 1006): void { this.readyState = TestWebSocket.CLOSED; this.onclose?.({ code }); }
  deliver(event: object): void { this.onmessage?.({ data: JSON.stringify(event) }); }
}
export class TestHeartbeatWorker {
  static all: TestHeartbeatWorker[] = [];
  onmessage: (() => void) | null = null;
  stopped = false;
  constructor() { TestHeartbeatWorker.all.push(this); }
  postMessage(): void {}
  terminate(): void { this.stopped = true; }
}
export function installSocketHarness(): void {
  TestWebSocket.all = []; TestHeartbeatWorker.all = [];
  vi.stubGlobal('WebSocket', TestWebSocket); vi.stubGlobal('Worker', TestHeartbeatWorker);
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:synthetic-heartbeat', revokeObjectURL: vi.fn() }));
}
