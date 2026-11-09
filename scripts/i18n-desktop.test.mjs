import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readDesktopCatalogs } from './i18n/desktop.mjs';

for (const ending of ['</script>', '</script >', '</SCRIPT\t>', '</script\n>', '</script data-extra="ignored">']) {
  test(`native catalog extraction accepts the script end tag ${JSON.stringify(ending)}`, async t => {
    const temp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
    await fs.mkdir(temp, { recursive: true });
    const root = await fs.mkdtemp(path.join(temp, 'veyvox-native-tags-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const files = {
      'packages/desktop/src/l10n.ts': "const DESKTOP_CATALOGS = { en: { greeting: 'Hello' } };",
      'packages/desktop/resources/recovery.html': `<script>const STRINGS = { en: { greeting: 'Hello' } };${ending}`,
      'packages/desktop/resources/instance-picker.html': `<script>const STRINGS = { en: { greeting: 'Hello' } };${ending}`,
    };
    for (const [file, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.writeFile(path.join(root, file), text);
    }
    const result = readDesktopCatalogs(root);
    assert.deepEqual(result.findings, []);
    assert.equal(result.catalogs.length, 3);
    for (const catalog of result.catalogs) assert.equal(catalog.values.greeting, 'Hello');
  });
}
