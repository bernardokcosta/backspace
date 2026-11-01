import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIAGNOSTIC_LOG_MAX_BYTES } from '../src/utils/diagnosticLogs.js';

describe('combined default application logging budget', () => {
  it('keeps central files and all three Compose service logs below 5 GB', () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
    const compose = fs.readFileSync(path.join(root, 'docker-compose.yml'), 'utf8');
    const policies = [...compose.matchAll(/logging:\s*\n\s+driver: json-file\s*\n\s+options:\s*\n\s+max-size: "(\d+)"\s*\n\s+max-file: "(\d+)"/g)];
    expect(policies).toHaveLength(3);
    const bytes = DIAGNOSTIC_LOG_MAX_BYTES + policies.reduce((total, match) => total + Number(match[1]) * Number(match[2]), 0);
    expect(bytes).toBe(4_950_000_000); expect(bytes).toBeLessThan(5_000_000_000);
  });
});
