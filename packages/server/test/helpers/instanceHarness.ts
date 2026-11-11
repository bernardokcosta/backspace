import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

/** Native process boot extracted from twoInstanceHarness; no handshake helpers. */
export interface SpawnedInstance {
  proc: ChildProcess;
  port: number;
  origin: string;
  domain: string;
  dbPath: string;
  storagePath: string;
  jwtSecret: string;
  logPath: string;
}
export interface SpawnInstanceOptions {
  domain: string;
  /** An explicit port opts out of collision retry. */
  port?: number;
  dbPath: string;
  storagePath: string;
  jwtSecret: string;
  logPath: string;
  disableRateLimits?: boolean;
  livekit?: { url: string; apiKey: string; apiSecret: string };
  /** Test overrides before protected bind/storage/identity fields. */
  environment?: Record<string, string>;
}
const logFinished = new WeakMap<ChildProcess, Promise<void>>();
async function allocateEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address && typeof address === 'object') server.close(() => resolve(address.port));
      else server.close(() => reject(new Error('Could not allocate ephemeral port')));
    });
  });
}
export async function exitedOnPortCollision(logPath: string): Promise<boolean> {
  try { return /EADDRINUSE/.test(await readFile(logPath, 'utf8')); } catch { return false; }
}
export async function readInstanceLog(instance: SpawnedInstance): Promise<string> {
  try { return await readFile(instance.logPath, 'utf8'); } catch { return ''; }
}
export async function stopInstance(instance: SpawnedInstance): Promise<void> {
  const proc = instance.proc;
  if (proc.exitCode === null && proc.signalCode === null) {
    await new Promise<void>(resolve => {
      const deadline = setTimeout(() => proc.kill('SIGKILL'), 3000);
      proc.once('exit', () => { clearTimeout(deadline); resolve(); });
      proc.kill('SIGTERM');
    });
  }
  await logFinished.get(proc);
}
async function spawnOnPort(port: number, options: SpawnInstanceOptions): Promise<SpawnedInstance> {
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env, ...options.environment, NODE_ENV: 'test',
    PORT: String(port), HOST: '127.0.0.1', DOMAIN: options.domain, PUBLIC_ORIGIN: origin,
    DB_PATH: options.dbPath, UPLOAD_DIR: options.storagePath, JWT_SECRET: options.jwtSecret,
    LIVEKIT_URL: options.livekit?.url ?? '', LIVEKIT_API_KEY: options.livekit?.apiKey ?? '',
    LIVEKIT_API_SECRET: options.livekit?.apiSecret ?? '', DISABLE_RATE_LIMITS: options.disableRateLimits === false ? '0' : '1',
    BACKUP_DISABLED: '1',
  };
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
  const proc = spawn(process.execPath, ['--import', 'tsx/esm', 'src/index.ts'], { cwd: serverDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const log = createWriteStream(options.logPath);
  proc.stdout!.pipe(log, { end: false }); proc.stderr!.pipe(log, { end: false });
  logFinished.set(proc, new Promise<void>(resolve => {
    log.once('finish', resolve); proc.once('close', () => log.end());
  }));
  const instance = { proc, port, origin, domain: options.domain, dbPath: options.dbPath, storagePath: options.storagePath, jwtSecret: options.jwtSecret, logPath: options.logPath };
  let startupError: Error | undefined;
  proc.once('error', error => { startupError = error; });
  try {
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      if (startupError) throw startupError;
      if (proc.exitCode !== null || proc.signalCode !== null) throw new Error(`Instance exited during boot: ${await readInstanceLog(instance)}`);
      try {
        const response = await fetch(`${origin}/api/instance/info`, { signal: AbortSignal.timeout(1000) });
        const ready = response.ok; await response.body?.cancel(); if (ready) return instance;
      } catch { /* Process has not bound yet. */ }
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error(`Instance did not become ready: ${await readInstanceLog(instance)}`);
  } catch (error) { await stopInstance(instance); throw error; }
}
export async function spawnInstance(options: SpawnInstanceOptions): Promise<SpawnedInstance> {
  if (options.port !== undefined) return spawnOnPort(options.port, options);
  let lastError: unknown;
  for (let attempt = 0; attempt <= 4; attempt++) {
    try { return await spawnOnPort(await allocateEphemeralPort(), options); }
    catch (error) {
      if (!await exitedOnPortCollision(options.logPath)) throw error;
      lastError = error;
    }
  }
  throw new Error(`Instance ${options.domain} lost the port race five times: ${String(lastError)}`);
}

/** Single-instance part of the old multi-process fixture's directory lifecycle. */
export async function bootInstance(options: Pick<SpawnInstanceOptions, 'livekit' | 'disableRateLimits' | 'environment'> = {}): Promise<{
  instance: SpawnedInstance; cleanup: () => Promise<void>;
}> {
  const directory = await mkdtemp(path.join(tmpdir(), 'veyvox-native-instance-'));
  const storagePath = path.join(directory, 'uploads'); await mkdir(storagePath);
  try {
    const instance = await spawnInstance({ ...options, domain: 'native.test.local', dbPath: path.join(directory, 'db.sqlite'), storagePath,
      jwtSecret: randomBytes(32).toString('hex'), logPath: path.join(directory, 'server.log') });
    return { instance, cleanup: async () => { await stopInstance(instance); await rm(directory, { recursive: true, force: true }); } };
  } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
}
