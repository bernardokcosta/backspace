import type { MessageWithUser } from '@veyvox/shared';
import { isStickerMessage } from '../../utils/stickerMessages';

/**
 * Finds the newest text message the current user can open in the inline editor.
 * System messages, attachment-only messages and stickers (whose content is a
 * token, not text) are skipped. If the newest own
 * message is still optimistic, wait for the server copy instead of unexpectedly
 * opening an older message.
 */
export function findLastOwnEditableMessage(
  messages: readonly MessageWithUser[],
  selfUserId: string | null,
): MessageWithUser | null {
  if (!selfUserId) return null;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.type === 'system' || message.userId !== selfUserId) continue;
    if (message.id.startsWith('temp_')) return null;
    if (message.content?.trim() && !isStickerMessage(message.content)) return message;
  }

  return null;
}
