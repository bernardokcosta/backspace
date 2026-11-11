import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Attachment } from '@veyvox/shared';
import { useUIStore } from '../../stores/uiStore';
import { useTransferStore } from '../../stores/transferStore';
import { useFormatters } from '../../i18n/formatters';

interface AttachmentRendererProps {
  attachment: Attachment;
}

/** Format a duration in seconds as `m:ss` (or `h:mm:ss` for long clips). */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Whether *this* browser can decode HEVC (H.265) in a <video> element.
 *
 * Web-playability of HEVC is browser-dependent, so the server's `playable`
 * flag (computed Chromium-first) can't be authoritative for every client:
 * WebKit (Safari on macOS/iOS) decodes HEVC via the OS, while Chromium,
 * Firefox and stock Electron cannot. HEVC is the codec that the server's
 * "unplayable" verdict effectively hinges on, so we probe for it here and let
 * capable browsers attempt playback rather than blindly showing the fallback.
 *
 * Computed once at module load. `canPlayType` returns '' when unsupported and
 * 'maybe'/'probably' otherwise; Safari reports support for the hvc1/hev1 tags.
 */
const BROWSER_SUPPORTS_HEVC: boolean = (() => {
  if (typeof document === 'undefined') return false;
  const v = document.createElement('video');
  return v.canPlayType('video/mp4; codecs="hvc1"') !== '' ||
    v.canPlayType('video/mp4; codecs="hev1"') !== '';
})();

/**
 * Resolves the displayable URL for an attachment. Same logic used by inline
 * `<img>`/`<video>`/`<audio>` rendering and the file-card download button —
 * exported so right-click menus can use it without duplicating the rule.
 */
export function attUrlOf(filename: string): string {
  if (filename.startsWith('http') || filename.startsWith('/')) return filename;
  return `/api/uploads/${filename}`;
}

interface VideoAttachmentProps {
  attachment: Attachment;
  attUrl: string;
  thumbUrl: string | null;
}

/**
 * Video attachment with a graceful fallback for formats the browser can't
 * decode. The dominant case is a macOS screen recording (HEVC inside a .mov):
 * the upload succeeds and a server-side poster is generated, but inline
 * `<video>` playback silently fails (stuck at 0:00). We resolve this two ways:
 *
 *   1. Proactive — the server classifies web-playability from the probed codec
 *      (`attachment.playable === false`), so we render the download card
 *      directly with no flash of a dead player. This is honoured only when the
 *      current browser also can't decode the format: the server flag is
 *      Chromium-first, but WebKit (Safari/iOS) decodes HEVC, so a Safari user
 *      still gets inline playback (see `BROWSER_SUPPORTS_HEVC`).
 *   2. Reactive — for the optimistic/unknown cases, and for capable browsers
 *      attempting a flagged file, the `<video>` `onError` handler flips to the
 *      same card if playback actually fails at runtime.
 *
 * The fallback card surfaces the poster (still a useful preview), filename,
 * duration and size, and a one-tap download — never a silently broken player.
 */
function VideoAttachment({ attachment, attUrl, thumbUrl }: VideoAttachmentProps) {
  const { t } = useTranslation(['chat']);
  const { formatBytes } = useFormatters();
  const startDownload = useTransferStore((s) => s.startDownload);
  // Pre-fail only when the server flagged it unplayable AND this browser can't
  // decode it anyway. Capable browsers (Safari/WebKit ⇒ HEVC) attempt playback
  // and fall back via onError if it genuinely fails.
  const [failed, setFailed] = useState(attachment.playable === false && !BROWSER_SUPPORTS_HEVC);

  const { width, height, originalName, mimetype, size, duration } = attachment;
  const hasDimensions = !!(width && height);
  const sizing = hasDimensions
    ? { aspectRatio: `${width}/${height}`, maxHeight: 300 }
    : undefined;

  if (failed) {
    const meta = [duration ? formatDuration(duration) : null, formatBytes(size)]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className="mt-1 max-w-[400px]">
        <button
          type="button"
          onClick={() => {
            void startDownload(attUrl, { filename: originalName, size, mimetype, tray: true });
          }}
          className="block w-full text-left rounded-lg overflow-hidden border border-border-hard bg-surface-channel/50 hover:bg-interactive-hover transition-all group/vid"
        >
          {thumbUrl && (
            <div className="relative w-full" style={sizing}>
              <img
                src={thumbUrl}
                alt={originalName}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-black/45 flex flex-col items-center justify-center gap-1.5 text-white">
                <svg className="w-9 h-9" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
                </svg>
                <span className="text-[12px] font-medium">{t('chat:attachment.video.cannotPlayDownload')}</span>
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 p-3">
            {!thumbUrl && (
              <div className="p-2 bg-surface-base rounded text-txt-tertiary flex-shrink-0">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-txt-link text-[14px] font-medium truncate group-hover/vid:underline">{originalName}</p>
              <p className="text-[12px] text-txt-tertiary">
                {meta ? `${meta} · ` : ''}{t('chat:attachment.video.unsupportedFormat')}
              </p>
            </div>
          </div>
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 max-w-[400px]">
      <div
        className="relative max-h-[300px] rounded-lg overflow-hidden"
        style={sizing}
      >
        <video
          controls
          preload={hasDimensions ? 'none' : 'metadata'}
          poster={thumbUrl ?? undefined}
          src={attUrl}
          onError={() => setFailed(true)}
          className="w-full h-full rounded-lg"
        >
          {t('chat:attachment.video.unsupportedBrowser')}
        </video>
      </div>
    </div>
  );
}

export function AttachmentRenderer({ attachment }: AttachmentRendererProps) {
  const { t } = useTranslation(['chat']);
  const { formatBytes } = useFormatters();
  const openImagePreview = useUIStore((s) => s.openImagePreview);
  const startDownload = useTransferStore((s) => s.startDownload);

  const attUrl = attUrlOf(attachment.filename);

  const thumbUrl = attachment.thumbnailFilename
    ? attachment.thumbnailFilename.startsWith('http') || attachment.thumbnailFilename.startsWith('/')
      ? attachment.thumbnailFilename
      : `/api/uploads/${attachment.thumbnailFilename}`
    : null;

  const { mimetype, originalName, size } = attachment;

  if (mimetype.startsWith('image/')) {
    const { width, height } = attachment;
    return (
      <div className="mt-1 max-w-fit">
        <div
          className="relative rounded-lg overflow-hidden border border-white/[0.06]"
          style={width && height ? { aspectRatio: `${width}/${height}`, maxWidth: Math.min(width, 400), maxHeight: 300 } : undefined}
        >
          <img
            src={thumbUrl ?? attUrl}
            data-sticker-source={attUrl}
            alt={originalName}
            className="w-full h-full max-w-[400px] max-h-[300px] object-contain cursor-pointer hover:brightness-95 transition-all"
            onClick={() => openImagePreview(attUrl)}
            loading="lazy"
          />
        </div>
      </div>
    );
  }

  if (mimetype.startsWith('video/')) {
    return (
      <VideoAttachment
        attachment={attachment}
        attUrl={attUrl}
        thumbUrl={thumbUrl}
      />
    );
  }

  if (mimetype.startsWith('audio/')) {
    return (
      <div className="relative mt-1 flex flex-col p-3 bg-surface-channel/50 rounded-lg border border-border-hard max-w-[420px]">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-surface-base rounded text-txt-tertiary flex-shrink-0">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
              />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-txt-primary text-[14px] font-medium truncate">{originalName}</p>
            <div className="flex items-center gap-2">
              <p className="text-[12px] text-txt-tertiary">{formatBytes(size)}</p>
            </div>
          </div>
        </div>
        <audio controls preload="metadata" className="w-full mt-2 h-8">
          <source src={attUrl} type={mimetype} />
          {t('chat:attachment.audio.unsupportedBrowser')}
        </audio>
      </div>
    );
  }

  // Generic-file chip (PDF / .zip / .exe / unknown mimetypes).
  //
  // Width contract: the chip must fit inside the message column on every
  // viewport. We cap at 400 px on roomy layouts but `max-w-full` keeps it
  // inside narrow columns (mobile, narrow desktop window, threaded reply
  // contexts). `min-w-0` is the critical bit on the inner flex children — the
  // outer button is a flex container with a fixed-size icon and a flexible
  // text block; without `min-w-0` the long-filename child would refuse to
  // shrink (flex children's min-content size defaults to their intrinsic
  // content) and would push the entire chip past the parent's right edge.
  return (
    <button
      type="button"
      onClick={() => {
        void startDownload(attUrl, {
          filename: originalName,
          size,
          mimetype,
          tray: true,
        });
      }}
      className="mt-1 max-w-full desktop:max-w-[400px] flex items-center gap-3 p-4 bg-surface-channel/50 rounded-lg border border-border-hard hover:bg-interactive-hover transition-all group/att text-left w-full min-w-0"
    >
      <div className="p-2 bg-surface-base rounded text-txt-tertiary group-hover/att:text-txt-primary transition-colors flex-shrink-0">
        <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 10v6m0 0l-3-3m3 3l3-3M3 17V7a2 2 0 012-2h6l2 2h6a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z"
          />
        </svg>
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-txt-link text-[15px] font-medium truncate hover:underline">{originalName}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-[12px] text-txt-tertiary font-medium">{formatBytes(size)}</p>
        </div>
      </div>
    </button>
  );
}
