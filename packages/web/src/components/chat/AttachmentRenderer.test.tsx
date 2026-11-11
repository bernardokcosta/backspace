import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Attachment } from '@veyvox/shared';
vi.mock('../../audio/AudioManager', () => ({ AudioManager: { getInstance: () => ({}) } }));
import { AttachmentRenderer } from './AttachmentRenderer';
import { useUIStore } from '../../stores/uiStore';
import { useTransferStore } from '../../stores/transferStore';
const download = vi.fn(async () => 'download');
const attachment: Attachment = { id: 'a', filename: 'native.bin', originalName: 'Original.bin', size: 100, mimetype: 'application/octet-stream', createdAt: 1 } as Attachment;
beforeEach(() => { download.mockClear(); useTransferStore.setState({ startDownload: download }); });
describe('native attachment surfaces', () => {
  it('downloads the native file and ignores obsolete federation metadata on untyped input', () => {
    const legacy = { ...attachment, federationStatus: 'remote', federationMeta: '{"sourceUsername":"Old foreign account"}' };
    const { container } = render(<AttachmentRenderer attachment={legacy} />);
    expect(container.querySelector('.glass-pill')).toBeNull(); fireEvent.click(screen.getByRole('button'));
    expect(download).toHaveBeenCalledWith('/api/uploads/native.bin', expect.objectContaining({ filename: 'Original.bin' }));
  });
  it('opens the original native image from its thumbnail', () => {
    const open = vi.spyOn(useUIStore.getState(), 'openImagePreview').mockImplementation(() => {});
    render(<AttachmentRenderer attachment={{ ...attachment, filename: 'image.png', thumbnailFilename: 'thumb.png', mimetype: 'image/png' }} />);
    const image = screen.getByRole('img'); expect(image).toHaveAttribute('src', '/api/uploads/thumb.png'); fireEvent.click(image);
    expect(open).toHaveBeenCalledWith('/api/uploads/image.png'); open.mockRestore();
  });
  it('retains the unplayable-video poster/download fallback', () => {
    render(<AttachmentRenderer attachment={{ ...attachment, mimetype: 'video/quicktime', playable: false, duration: 5, thumbnailFilename: 'poster.png' }} />);
    expect(screen.getByRole('img')).toHaveAttribute('src', '/api/uploads/poster.png'); fireEvent.click(screen.getByRole('button'));
    expect(download).toHaveBeenCalledWith('/api/uploads/native.bin', expect.objectContaining({ filename: 'Original.bin' }));
  });
});
