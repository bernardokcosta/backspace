import { describe, expect, it } from 'vitest';
import { setLanguage } from '../i18n';
import { parseInviteInput } from './inviteParser';

describe('localized invite input validation', () => {
  it('translates local validation without changing codes or remote origins', async () => {
    await setLanguage('pt');
    try {
      expect(() => parseInviteInput('')).toThrow('O código do convite é obrigatório.');
      expect(() => parseInviteInput('https://fixture.example.test/wrong')).toThrow('https://instance/join/CODE');
      expect(parseInviteInput('CODE@fixture.example.test')).toEqual({ code: 'CODE', origin: 'https://fixture.example.test' });
    } finally { await setLanguage('en'); }
  });
});
