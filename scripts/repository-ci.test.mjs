import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { readBuildYaml } from './desktop-release-assets.mjs';
import { ESLint } from 'eslint';

const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const workflow = name => readBuildYaml(read(`.github/workflows/${name}.yml`));

test('lint excludes ignored agent evidence, not tracked project tooling', async () => {
  const eslint = new ESLint();
  assert.equal(await eslint.isPathIgnored('.superpowers/sdd/example/probe.mjs'), true);
  assert.equal(await eslint.isPathIgnored('scripts/verify-gitleaks-policy.mjs'), false);
  assert.equal(await eslint.isPathIgnored('packages/web/src/build/devCsp.ts'), false);
});

test('all tooling suites feed the required gate', () => {
  const pkg = JSON.parse(read('package.json'));
  const ci = workflow('ci');
  assert.equal(pkg.scripts['test:tooling'], 'node --test "scripts/*.test.mjs" "flatpak/*.test.mjs" "packages/desktop/scripts/*.test.mjs"');
  const steps = ci.jobs['build-and-test'].steps;
  const commands = steps.map(step => step.run ?? '').join('\n');
  for (const command of ['pnpm test:tooling', 'pnpm -r test', 'node flatpak/node-sdk-version.mjs', 'pnpm build', 'pnpm --filter @veyvox/server typecheck:e2e', 'pnpm --filter @veyvox/desktop build:ts']) {
    assert.ok(commands.includes(command), command);
  }
  const pairing = steps.find(step => step.run?.includes('node flatpak/sources-pairing.mjs'));
  assert.ok(pairing);
  assert.equal(pairing.if, "github.event_name == 'pull_request'");
  assert.equal(pairing.env.BASE_SHA, '${{ github.event.pull_request.base.sha }}');
  assert.equal(pairing.env.HEAD_SHA, '${{ github.event.pull_request.head.sha }}');
  assert.match(pairing.run, /"\$BASE_SHA" "\$HEAD_SHA"/);
  assert.equal(steps.find(step => step.uses?.startsWith('actions/checkout@')).with['fetch-depth'], 0);
  const gate = ci.jobs['build-and-test-required'];
  assert.equal(gate.name, 'Build & test');
  assert.equal(gate.if, 'always()');
  assert.deepEqual(gate.needs, ['build-and-test', 'build-image', 'lint', 'native-sdr']);
  for (const job of gate.needs) {
    assert.ok(gate.steps[0].run.includes(`if [ "\${{ needs.${job}.result }}" != "success" ]; then`));
  }
});

test('standalone artifact absence runs after the complete production and desktop builds', () => {
  const steps = workflow('ci').jobs['build-and-test'].steps;
  const gate = steps.findIndex(step => step.run === 'node scripts/check-standalone.mjs --artifacts');
  assert.ok(gate >= 0, 'missing emitted-code retirement gate');
  for (const command of ['pnpm build', 'pnpm --filter @veyvox/desktop build:ts']) {
    const build = steps.findIndex(step => step.run === command);
    assert.ok(build >= 0 && build < gate, command);
  }
  assert.equal(steps[gate].if, undefined);
  assert.notEqual(steps[gate]['continue-on-error'], true);
});

test('native validation keeps callers without duplicate push runs', () => {
  const native = workflow('native-sdr-capture');
  assert.deepEqual(Object.keys(native.on).sort(), ['workflow_call', 'workflow_dispatch']);
  for (const caller of ['ci', 'release']) {
    assert.equal(workflow(caller).jobs['native-sdr'].uses, './.github/workflows/native-sdr-capture.yml');
  }
  const build = native.jobs['native-build-and-load'];
  assert.deepEqual(build.strategy.matrix.include.map(entry => entry.arch), ['x64', 'arm64']);
  const commands = build.steps.map(step => step.run ?? '').join('\n');
  for (const command of ['build-sdr-capture.mjs', '--mode baseline', '--mode module', '--publish never', 'verify-sdr-capture-package.mjs']) {
    assert.ok(commands.includes(command), command);
  }
  const validation = native.jobs['workflow-validation'].steps.map(step => step.run ?? '').join('\n');
  assert.match(validation, /"\$RUNNER_TEMP\/actionlint" -oneline\s*$/);
});

test('PR scanners preserve enforcing contexts without path omissions', () => {
  const security = workflow('security');
  assert.ok(Object.hasOwn(security.on, 'pull_request'));
  assert.equal(security.on.pull_request?.paths, undefined);
  assert.deepEqual(Object.values(security.jobs).map(job => job.name), [
    'Secret scan (gitleaks)', 'Dependency scan (OSV-Scanner)',
    'IaC/config scan (Trivy)', 'License compliance scan (Trivy)',
  ]);
  for (const job of Object.values(security.jobs)) {
    assert.notEqual(job['continue-on-error'], true);
    for (const step of job.steps) assert.notEqual(step['continue-on-error'], true);
  }
  assert.equal(workflow('codeql').on.pull_request.paths, undefined);
  assert.equal(fs.existsSync(new URL('../.github/workflows/flatpak-release-metadata.yml', import.meta.url)), false);
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.pnpm.overrides['@cloudflare/vitest-pool-workers>zod'], undefined);
  assert.doesNotMatch(read('.github/dependabot.yml'), /dependency-name: vitest/);
});
