import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { JunoTile } from './JunoTile';
import { useUIStore } from '../../stores/uiStore';
import { useJunoStore } from '../../stores/junoStore';
import { useVoiceStore } from '../../stores/voiceStore';
import { useAuthStore } from '../../stores/authStore';
import { useSpaceStore } from '../../stores/spaceStore';

/** A shared list, not a game launch: picking Juno opens its existing lobby/table. */
export function GamesPicker() {
  const isOpen = useUIStore(s => s.activeModal === 'games');
  const modalData = useUIStore(s => s.modalData);
  const closeModal = useUIStore(s => s.closeModal);
  const target = useJunoStore(s => s.target);
  const connected = useJunoStore(s => s.connected);
  const accountId = useAuthStore(s => s.user?.id);
  const voiceChannelId = useVoiceStore(s => s.currentVoiceChannelId);
  const voiceConnected = useVoiceStore(s => s.isLiveKitConnected && s.voiceConnectionStatus === 'connected');
  const channel = useSpaceStore(s => target ? s.spaceChannelIndex.get(target.channelId) : undefined);
  const navigate = useNavigate();
  const valid = !!target && connected && voiceConnected && target.accountId === accountId
    && target.channelId === voiceChannelId && channel?.type === 'voice' && channel.origin === target.origin
    && modalData.accountId === target.accountId && modalData.selfId === target.selfId
    && modalData.channelId === target.channelId && modalData.origin === target.origin;

  useEffect(() => {
    const ui = useUIStore.getState();
    if (isOpen && !valid && ui.activeModal === 'games' && ui.modalData === modalData) closeModal();
  }, [isOpen, valid, modalData, closeModal]);

  if (!isOpen || !valid) return null;

  const openJuno = () => {
    const ui = useUIStore.getState();
    const game = useJunoStore.getState();
    const voice = useVoiceStore.getState();
    const currentChannel = useSpaceStore.getState().spaceChannelIndex.get(target.channelId);
    // A stale click must not open a table belonging to another call/account.
    if (ui.activeModal !== 'games' || ui.modalData !== modalData || game.target !== target
        || !game.connected || !voice.isLiveKitConnected || voice.voiceConnectionStatus !== 'connected'
        || voice.currentVoiceChannelId !== target.channelId || useAuthStore.getState().user?.id !== target.accountId
        || currentChannel?.type !== 'voice' || currentChannel.origin !== target.origin) return;
    ui.closeModal();
    voice.setFocusedParticipant(null);
    game.setOpen(true);
    if (ui.isMobile) {
      if (ui.mobileStack.at(-1)?.screen !== 'voice-full') ui.pushMobileScreen('voice-full');
    } else {
      void navigate(`/channels/${encodeURIComponent(currentChannel.spaceId)}/${encodeURIComponent(target.channelId)}`);
    }
  };

  return <Modal isOpen onClose={closeModal} maxWidth="max-w-lg" mobileStyle="sheet">
    <GamesDialog onClose={closeModal} onOpenJuno={openJuno} />
  </Modal>;
}

function GamesDialog({ onClose, onOpenJuno }: { onClose: () => void; onOpenJuno: () => void }) {
  const { t } = useTranslation(['voice', 'common']);
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); onClose(); return;
    }
    if (event.key !== 'Tab') return;
    const buttons = ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    const first = buttons?.[0]; const last = buttons?.[buttons.length - 1];
    if (event.shiftKey && document.activeElement === first && last) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last && first) {
      event.preventDefault(); first.focus();
    }
  };
  return <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={keyDown}>
    <div className="flex items-center justify-between gap-3 mb-2">
      <h2 id={titleId} className="text-xl font-semibold text-txt-primary">{t('voice:juno.games')}</h2>
      <button type="button" onClick={onClose} aria-label={t('common:actions.close')}
        className="w-9 h-9 shrink-0 rounded-full text-txt-tertiary hover:text-txt-primary hover:bg-interactive-hover focus-visible:ring-2 focus-visible:ring-accent-primary">×</button>
    </div>
    <p className="text-sm text-txt-secondary mb-4">{t('voice:juno.chooseGame')}</p>
    <ul className="card-grid">
      <li>
        <div className="h-40"><JunoTile onOpen={onOpenJuno} /></div>
        <p className="text-[13px] text-txt-secondary leading-relaxed mt-3">{t('voice:juno.description')}</p>
      </li>
    </ul>
  </div>;
}
