import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ErrorDetails } from '@backspace/shared/src/errors';
import { desktopCompatibilityDecision, identifyDesktop } from '@backspace/shared/src/desktopCompatibility';
import { config } from '../config.js';
import { sendError } from './httpErrors.js';

export class DesktopUpdateRequiredError extends Error {
  readonly statusCode = 426;
  readonly code = 'desktop_update_required' as const;
  constructor(readonly details: ErrorDetails) {
    super(`Desktop version ${details.minimumVersion} or newer is required. Update the app or use a browser.`);
  }
}

/** Call only with bot status from the verified token/account/proof, never clientKind. */
export function requireCompatibleDesktop(userAgent: string | undefined, principal: { isBot: boolean }, minimumVersion: string | null): void {
  if (minimumVersion === null || principal.isBot) return;
  const desktop = identifyDesktop(userAgent ?? '');
  if (desktop.kind !== 'desktop' || desktopCompatibilityDecision(desktop.version, minimumVersion) === 'allowed') return;
  throw new DesktopUpdateRequiredError({ minimumVersion, ...(desktop.version ? { currentVersion: desktop.version } : {}) });
}

export function guardDesktopAccess(request: Pick<FastifyRequest, 'headers'>, reply: FastifyReply, principal: { isBot: boolean }): boolean {
  try { requireCompatibleDesktop(request.headers['user-agent'], principal, config.minimumDesktopVersion); return true; }
  catch (error) {
    if (!(error instanceof DesktopUpdateRequiredError)) throw error;
    sendError(reply, error.statusCode, error.code, error.details);
    return false;
  }
}
