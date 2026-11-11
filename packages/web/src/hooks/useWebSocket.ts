import { useEffect, useState } from 'react';
import type { ServerEvent, ClientEvent, MessageWithUser } from '@veyvox/shared';
import { ConnectionState as LiveKitConnectionState } from 'livekit-client';
import { getElectronAPI } from '../platform/platform';
import { detectClientKind } from '../platform/clientKind';
import { fetchCurrentActivities } from '../platform/activityBridge';
import { receiveChannelPoke } from '../components/chat/channelPoke';
import { receiveSoundboardPlay } from '../audio/soundboardPlayback';
import { useJunoStore } from '../stores/junoStore';
import { soundboardKey, useSoundboardStore } from '../stores/soundboardStore';
import { useChannelPokeStore } from '../stores/channelPokeStore';
import { useEphemeralReplyStore } from '../stores/ephemeralReplyStore';
import { applySpaceMemberUpdate } from '../stores/spaceMemberUpdates';
import { useUnreadCountStore } from '../stores/unreadCountStore';
import { useAuthStore } from '../stores/authStore';
import { useSpaceStore } from '../stores/spaceStore';
import { useChatStore } from '../stores/chatStore';
import { useVoiceStore } from '../stores/voiceStore';
import { useSocialStore } from '../stores/socialStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useDeveloperModeStore } from '../stores/developerModeStore';
import { useActivityStore } from '../stores/activityStore';
import { useDiscoverStore } from '../stores/discoverStore';
import { useUIStore } from '../stores/uiStore';
import { useNotificationSettingsStore } from '../stores/notificationSettingsStore';
import { notePendingReady } from '../stores/pendingMessageRehydrate';
import { recordDiagnostic } from '../utils/diagnostics';
import { broadcastVoiceStatus, broadcastDeafenViaLiveKit, joinVoiceChannel } from '../utils/voice';
import { turnCameraOnInDmCall } from '../utils/voiceActions';
import { applySpaceVoiceState } from '../utils/voiceStateSync';
import { applyIncomingDmMessage } from '../utils/dmMessageRouting';
import { describeErrorCode } from '../i18n/errors';
import i18n from '../i18n';
import { invalidateHomeInstanceInfo } from './useHomeInstanceInfo';
import { getActiveRoom } from './useLiveKit';

interface Connection {
  ws: WebSocket | null;
  heartbeatWorker: Worker | null;
  heartbeatUrl: string | null;
  reconnectAttempts: number;
  reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  token: string;
  revision: number;
  origin: string;
}
let connection: Connection | null = null;

/** A delayed socket callback belongs to exactly the session that opened it. */
function ownsSession(conn: Connection): boolean {
  const auth = useAuthStore.getState();
  return connection === conn && auth.token === conn.token && auth.sessionRevision === conn.revision && window.location.origin === conn.origin;
}
function stopHeartbeat(conn: Connection): void {
  conn.heartbeatWorker?.postMessage('stop'); conn.heartbeatWorker?.terminate(); conn.heartbeatWorker = null;
  if (conn.heartbeatUrl !== null) URL.revokeObjectURL(conn.heartbeatUrl);
  conn.heartbeatUrl = null;
}
function startHeartbeat(conn: Connection): void {
  stopHeartbeat(conn);
  conn.heartbeatUrl = URL.createObjectURL(new Blob([`
    let timer = null;
    self.onmessage = function(event) {
      if (event.data === 'start') {
        if (timer) clearInterval(timer);
        timer = setInterval(function() { self.postMessage('tick'); }, 15000);
      } else if (event.data === 'stop' && timer) { clearInterval(timer); timer = null; }
    };
  `], { type: 'application/javascript' }));
  const worker = new Worker(conn.heartbeatUrl); conn.heartbeatWorker = worker;
  worker.onmessage = () => {
    if (ownsSession(conn) && conn.heartbeatWorker === worker && conn.ws?.readyState === WebSocket.OPEN) conn.ws.send(JSON.stringify({ type: 'ping' }));
  };
  worker.postMessage('start');
}
function disconnect(conn: Connection): void {
  if (connection === conn) connection = null;
  clearTimeout(conn.reconnectTimer); conn.reconnectTimer = undefined; stopHeartbeat(conn);
  const ws = conn.ws; conn.ws = null; ws?.close();
}

/** A delayed call-end echo must never tear down a newly joined space room. */
export function teardownDmCall(): void {
  const voice = useVoiceStore.getState();
  voice.setIncomingCall(null); voice.setOutgoingCall(null); voice.setActiveDmCall(null);
  if (!voice.currentVoiceChannelId) void voice.disconnectFn?.();
}
export function dmCallEventIsOurs(event: { dmChannelId: string }): boolean {
  const voice = useVoiceStore.getState();
  return !!event.dmChannelId && [voice.incomingCall, voice.outgoingCall, voice.activeDmCall].some(call => call?.dmChannelId === event.dmChannelId);
}
export function acceptStopsRing(event: { dmChannelId: string; answeredByUserId: string }): boolean {
  return useVoiceStore.getState().incomingCall?.dmChannelId === event.dmChannelId && event.answeredByUserId === useAuthStore.getState().user?.id;
}

function handleEvent(event: ServerEvent, readyAlreadyDelivered: boolean, current: () => boolean): void {
  const spaces = useSpaceStore.getState(), chat = useChatStore.getState(), voice = useVoiceStore.getState();
  const auth = useAuthStore.getState(), social = useSocialStore.getState();
  switch (event.type) {
    case 'ready': {
      auth.setUser(event.user);
      const settings = useSettingsStore.getState();
      settings.setIsAdmin(event.user.isAdmin ?? false); void settings.fetchStreamingLimits(); void settings.fetchGifEnabled();
      settings.setUpdateAckUser(event.user.id); useDeveloperModeStore.getState().setEnabled(event.user.developerMode === true);
      if (event.user.isAdmin) void settings.fetchUpdateStatus();
      useJunoStore.getState().setSupported(event.supportsJuno === true);
      useChannelPokeStore.getState().setSupported(event.supportsPoke === true);
      spaces.populateFromReady(event.spaces, event.folders, event.dmChannels, event.spaceLayout, event.layoutUpdatedAt);
      notePendingReady(); void useNotificationSettingsStore.getState().load();
      if (spaces.currentSpaceId) void spaces.loadSpaceDetail(spaces.currentSpaceId);

      // A replacement socket may have missed messages; a same-socket refresh did not.
      if (!readyAlreadyDelivered) {
        useChatStore.setState({ messages: new Map(), hasMore: new Map() });
        if (chat.currentChannelId) void chat.loadMessages(chat.currentChannelId, true);
      }
      useUnreadCountStore.getState().hydrate(event.unreadCounts);
      if (event.readStates) chat.setReadStates(event.readStates, useSpaceStore.getState().channelLastMessageIds);
      const known = useSpaceStore.getState();
      const orphaned = new Set([...chat.unreadChannels].filter(id => !known.spaceChannelIndex.has(id) && !known.dmChannels.some(dm => dm.id === id)));
      chat.removeChannelStates(orphaned);

      voice.clearAllVoiceUsers();
      for (const [id, users] of Object.entries(event.voiceStates ?? {})) voice.setVoiceUsers(id, users);
      for (const [id, seconds] of Object.entries(event.voiceChannelElapsedSeconds ?? {})) voice.setVoiceChannelElapsedSeconds(id, seconds);
      useActivityStore.getState().initActivities(event.userActivities ?? {});
      if (event.user.showActivity !== undefined) useActivityStore.setState({ showActivity: event.user.showActivity });
      if (getElectronAPI()?.getCurrentActivities || getElectronAPI()?.getCurrentActivity) {
        void fetchCurrentActivities().then(activities => {
          if (!current()) return;
          if (activities.length) useActivityStore.getState().pushActivities(activities); else useActivityStore.getState().republish();
        }).catch(() => {});
      } else useActivityStore.getState().republish();

      useVoiceStore.setState({ voiceUserStates: new Map() });
      for (const [id, status] of Object.entries(event.voiceUserStates ?? {})) voice.setVoiceUserStatus(id, status.isMuted, status.isDeafened, status.isCameraOn, status.isScreenSharing);
      const spaceMutedUserIds = new Set<string>(), spaceDeafenedUserIds = new Set<string>(), permissionMutedUserIds = new Set<string>();
      for (const [id, status] of Object.entries(event.spaceVoiceStates ?? {})) {
        if (status.spaceMuted) spaceMutedUserIds.add(id);
        if (status.spaceDeafened) spaceDeafenedUserIds.add(id);
        if (status.permissionMuted) permissionMutedUserIds.add(id);
      }
      useVoiceStore.setState({ spaceMutedUserIds, spaceDeafenedUserIds, permissionMutedUserIds });

      // LiveKit may survive a signaling reconnect. Reclaim the new socket only
      // for a live space session, never a completed disconnect kept for Retry.
      if (voice.currentVoiceChannelId && !readyAlreadyDelivered) {
        const room = getActiveRoom();
        if (voice.voiceConnectionStatus === 'connecting' || voice.voiceConnectionStatus === 'reconnecting'
            || (room && [LiveKitConnectionState.Connected, LiveKitConnectionState.Connecting, LiveKitConnectionState.Reconnecting, LiveKitConnectionState.SignalReconnecting].includes(room.state))) {
          wsSend({ type: 'voice_join', channelId: voice.currentVoiceChannelId }); broadcastVoiceStatus();
        }
      }
      if (voice.activeDmCall) broadcastVoiceStatus();
      const calls = event.activeCalls ?? [];
      // Restoring a ring is not permission to auto-connect media after a reload.
      const ring = calls.find(call => call.state === 'ringing' && call.callerId !== event.user.id);
      if (ring) {
        const caller = event.dmChannels?.find(dm => dm.id === ring.dmChannelId)?.members.find(member => member.id === ring.callerId);
        voice.setIncomingCall({ dmChannelId: ring.dmChannelId, callerId: ring.callerId, callerName: caller?.displayName || caller?.username || ring.callerId });
      } else voice.setIncomingCall(null);
      if (voice.activeDmCall && !calls.some(call => call.dmChannelId === voice.activeDmCall?.dmChannelId)) {
        voice.setActiveDmCall(null); if (!voice.currentVoiceChannelId) void voice.disconnectFn?.();
      }
      if (voice.outgoingCall && !calls.some(call => call.dmChannelId === voice.outgoingCall?.dmChannelId)) voice.setOutgoingCall(null);
      void social.loadFriends(); void social.loadRequests();
      break;
    }
    case 'channel_poke':
      spaces.upsertUserView(event.message.user); chat.addRealtimeMessage(event.message.channelId, event.message); receiveChannelPoke(event.message); break;
    case 'interaction_ephemeral': spaces.upsertUserView(event.reply.user); useEphemeralReplyStore.getState().add(event.reply); break;
    case 'channel_unread_count': useUnreadCountStore.getState().updateCounts(event.counts); break;
    case 'message_created':
      spaces.upsertUserView(event.message.user); if (event.message.replyTo?.user) spaces.upsertUserView(event.message.replyTo.user);
      chat.addRealtimeMessage(event.message.channelId, event.message);
      if (event.message.type !== 'system' && event.message.userId !== auth.user?.id && event.message.channelId !== chat.currentChannelId && !spaces.voiceChannelIds.has(event.message.channelId)) chat.markChannelUnread(event.message.channelId);
      break;
    case 'message_updated':
      spaces.upsertUserView(event.message.user); if (event.message.replyTo?.user) spaces.upsertUserView(event.message.replyTo.user);
      chat.updateMessage(event.message); break;
    case 'message_deleted': chat.removeMessage(event.messageId, event.channelId); break;
    case 'message_pinned':
      chat.applyPinEvent({ id: `${event.channelId}:${event.messageId}`, channelId: event.channelId, messageId: event.messageId, pinnedById: event.pinnedById, createdAt: Date.now(), message: null });
      void chat.loadPins(event.channelId); break;
    case 'message_unpinned': chat.applyUnpinEvent(event.channelId, event.messageId); break;
    case 'typing': chat.setTyping(event.channelId, event.userId, event.username); break;
    case 'presence_update':
      if (event.status !== 'online' && event.status !== 'idle' && event.status !== 'dnd' && event.status !== 'offline') break;
      if (auth.user?.id === event.userId) auth.setUser({ ...auth.user, status: event.status });
      spaces.updateMemberPresence(event.userId, event.status); social.updateFriendPresence(event.userId, event.status);
      if (event.activities) useActivityStore.getState().setUserActivities(event.userId, event.activities);
      break;
    case 'user_updated':
      spaces.updateUserEverywhere(event.user); social.updateFriendProfile(event.user); chat.updateUserInMessages(event.user);
      if (auth.user?.id === event.user.id) {
        if (event.user.isDeleted) { auth.logout(); break; }
        auth.setUser(event.user); useSettingsStore.getState().setIsAdmin(event.user.isAdmin ?? false);
        if (event.user.developerMode !== undefined) useDeveloperModeStore.getState().setEnabled(event.user.developerMode);
      }
      if (event.user.isDeleted) {
        social.removeDeletedUser(event.user.id); useActivityStore.getState().clearUserActivities(event.user.id);
        useDiscoverStore.getState().removeDeletedUser(event.user.id); chat.clearTypingForDeletedUser(event.user.id);
      }
      break;
    case 'juno_updated': useJunoStore.getState().invalidate(event.channelId); break;
    case 'soundboard_updated': {
      const store = useSoundboardStore.getState(); if (store.entries[soundboardKey(event.spaceId)]) void store.load(event.spaceId); break;
    }
    case 'soundboard_play': void receiveSoundboardPlay(event.channelId, event.spaceId, event.sound); break;
    case 'voice_state_update':
      if (event.action === 'join') {
        voice.addVoiceUser(event.channelId, event.userId); if (event.channelElapsedSeconds !== undefined) voice.setVoiceChannelElapsedSeconds(event.channelId, event.channelElapsedSeconds);
      } else { voice.removeVoiceUser(event.channelId, event.userId); voice.clearVoiceUserStatus(event.userId); }
      break;
    case 'voice_status_update': voice.setVoiceUserStatus(event.userId, event.isMuted, event.isDeafened, event.isCameraOn, event.isScreenSharing); break;
    case 'space_voice_state': applySpaceVoiceState(event); break;
    case 'voice_space_muted':
      voice.setSpaceMutedUser(event.spaceId, event.userId, event.muted, event.botSeat ? event.channelId : undefined);
      if (event.userId === auth.user?.id) broadcastVoiceStatus(); break;
    case 'voice_permission_muted':
      voice.setPermissionMutedUser(event.spaceId, event.userId, event.muted, event.channelId);
      if (event.userId === auth.user?.id) broadcastVoiceStatus(); break;
    case 'voice_space_deafened':
      voice.setSpaceDeafenedUser(event.spaceId, event.userId, event.deafened, event.botSeat ? event.channelId : undefined);
      if (event.userId === auth.user?.id) { broadcastVoiceStatus(); broadcastDeafenViaLiveKit(); } break;
    case 'voice_moved':
      if (event.userId === auth.user?.id) { voice.setCurrentVoiceChannel(null); joinVoiceChannel(event.newChannelId, voice.connectFn ?? undefined); } break;
    case 'voice_disconnected':
      if (event.userId === auth.user?.id && event.channelId === voice.currentVoiceChannelId) {
        voice.handleForceDisconnect(); void getActiveRoom()?.disconnect();
        if (event.reason === 'displaced') useUIStore.getState().addToast(i18n.t('voice:feedback.joinedOtherSession'), 'info');
      }
      break;
    case 'member_joined': spaces.upsertUserView(event.member.user); spaces.addMember(event.spaceId, event.member); break;
    case 'member_left': spaces.removeMember(event.spaceId, event.userId); break;
    case 'member_updated': if (event.spaceId === event.member.spaceId) applySpaceMemberUpdate(event.member); break;
    case 'member_banned': spaces.removeSpace(event.spaceId); break;
    case 'dm_message_created':
      spaces.upsertUserView(event.message.user); if (event.message.replyTo?.user) spaces.upsertUserView(event.message.replyTo.user);
      void applyIncomingDmMessage(event.message, current); break;
    case 'dm_message_updated':
      spaces.upsertUserView(event.message.user); if (event.message.replyTo?.user) spaces.upsertUserView(event.message.replyTo.user);
      chat.updateMessage(event.message as unknown as MessageWithUser); break;
    case 'dm_message_deleted': chat.removeMessage(event.messageId, event.dmChannelId); break;
    case 'embeds_resolved':
    case 'dm_embeds_resolved': {
      const channelId = event.type === 'embeds_resolved' ? event.channelId : event.dmChannelId;
      const message = chat.messages.get(channelId)?.find(row => row.id === event.messageId) ?? chat.detachedChannels.get(channelId)?.find(row => row.id === event.messageId);
      if (message) chat.updateMessage({ ...message, embeds: event.embeds }); break;
    }
    case 'dm_typing': chat.setTyping(event.dmChannelId, event.userId, event.username); break;
    case 'dm_typing_stop': chat.clearTyping(event.dmChannelId, event.userId); break;
    case 'reaction_added': chat.onReactionAdded(event.messageId, event.reaction); break;
    case 'reaction_removed': chat.onReactionRemoved(event.messageId, event.userId, event.emoji); break;
    case 'friend_request_received':
      if (event.request.user) spaces.upsertUserView(event.request.user); social.addIncomingRequest(event.request); break;
    case 'friend_request_sent':
      if (event.request.user) spaces.upsertUserView(event.request.user); social.addOutboundRequest(event.request); break;
    case 'friend_request_accepted':
      social.addFriendFromAccepted(event.friend, event.requestId); useDiscoverStore.getState().updateRelationship(event.friend.id, 'friends'); break;
    case 'friend_removed': social.removeFriendLocally(event.userId); useDiscoverStore.getState().updateRelationship(event.userId, 'none'); break;
    case 'friend_request_cancelled':
    case 'friend_request_declined':
      social.removeRequestById(event.requestId, event.userId); useDiscoverStore.getState().updateRelationship(event.userId, 'none'); break;
    case 'channel_ack': chat.onChannelAck(event.channelId, event.messageId); break;
    case 'mark_unread': chat.onMarkUnread(event.channelId, event.messageId); break;
    case 'dm_call_incoming':
      if (typeof event.dmChannelId === 'string' && event.dmChannelId) voice.setIncomingCall({ dmChannelId: event.dmChannelId, callerId: event.callerId, callerName: event.callerName }); break;
    case 'dm_call_accepted': {
      if (!dmCallEventIsOurs(event)) break;
      if (acceptStopsRing(event)) voice.setIncomingCall(null);
      const outgoing = voice.outgoingCall;
      if (outgoing?.dmChannelId === event.dmChannelId) {
        voice.setOutgoingCall(null);
        if (!voice.activeDmCall) {
          voice.setActiveDmCall({ dmChannelId: outgoing.dmChannelId });
          if (voice.connectFn) void voice.connectFn(outgoing.dmChannelId, true).then(() => current() && outgoing.withCamera ? turnCameraOnInDmCall(outgoing.dmChannelId) : undefined)
            .catch(error => console.error('[WS] DM call connect failed:', error));
        }
      }
      break;
    }
    case 'dm_call_rejected': if (dmCallEventIsOurs(event)) teardownDmCall(); break;
    case 'dm_call_ended': voice.setVoiceUsers(event.dmChannelId, []); if (dmCallEventIsOurs(event)) teardownDmCall(); break;
    case 'dm_channel_created': spaces.upsertDmChannel(event.dmChannel); break;
    case 'dm_channel_closed': spaces.removeDmChannel(event.dmChannelId); break;
    case 'dm_member_added': spaces.upsertUserView(event.user); spaces.addDmMember(event.dmChannelId, event.user); break;
    case 'dm_member_removed': spaces.removeDmMember(event.dmChannelId, event.userId); break;
    case 'dm_owner_updated': spaces.updateDmOwner(event.dmChannelId, event.newOwnerId); break;
    case 'dm_channel_updated': spaces.updateDmMetadata(event.dmChannelId, { name: event.name, icon: event.icon }); break;
    case 'channel_created':
    case 'channel_updated': spaces.upsertChannel(event.channel, event.spaceId); break;
    case 'channel_deleted': {
      spaces.removeChannel(event.channelId); if (chat.currentChannelId === event.channelId) chat.setCurrentChannel(null);
      const voiceUsers = new Map(voice.voiceUsers), voiceChannelElapsedSeconds = new Map(voice.voiceChannelElapsedSeconds);
      voiceUsers.delete(event.channelId); voiceChannelElapsedSeconds.delete(event.channelId); useVoiceStore.setState({ voiceUsers, voiceChannelElapsedSeconds });
      break;
    }
    case 'space_updated': spaces.setSpaces(spaces.spaces.map(space => space.id === event.space.id ? { ...space, ...event.space } : space)); break;
    case 'category_created':
    case 'category_updated': spaces.upsertCategory(event.category); break;
    case 'category_deleted': spaces.removeCategory(event.categoryId, event.spaceId); break;
    case 'channel_layout_updated': spaces.applyChannelLayout(event.spaceId, event.channels, event.categories); break;
    case 'notification_settings_updated': useNotificationSettingsStore.getState().apply(event.setting); break;
    case 'space_layout_updated':
      if ((event.updatedAt ?? 0) >= spaces._layoutUpdatedAt) useSpaceStore.setState({ spaceLayout: event.layout, folders: event.folders, _layoutUpdatedAt: event.updatedAt ?? 0 }); break;
    case 'join_request_accepted': spaces.addSpaceFromReady(event.space); break;
    case 'instance_settings_updated': {
      invalidateHomeInstanceInfo(); const settings = useSettingsStore.getState();
      if (settings.instanceSettings) useSettingsStore.setState({ instanceSettings: { ...settings.instanceSettings, spaceCreationOpen: event.spaceCreationOpen } });
      if (!event.spaceCreationOpen && !auth.user?.isAdmin && !settings.isAdmin && useUIStore.getState().activeModal === 'createSpace') useUIStore.getState().closeModal(); break;
    }
    case 'space_access_changed': void refreshSpaceAccess(event.spaceId, current); break;
    case 'error':
      recordDiagnostic({ event: 'ws-error', subsystem: 'websocket', level: 'error', errorCode: event.code });
      console.error('WebSocket error:', event.message);
      if (event.dmChannelId) {
        if (voice.outgoingCall?.dmChannelId === event.dmChannelId) voice.setOutgoingCall(null);
        if ((event.code === 'dm_call_not_found' || event.code === 'not_dm_member') && voice.activeDmCall?.dmChannelId === event.dmChannelId) teardownDmCall();
      }
      if (event.code) useUIStore.getState().addToast(describeErrorCode(event.code, event.message, event.details), 'warning'); break;
    case 'join_request_received':
    case 'join_request_declined':
    case 'pong': break;
  }
}

/** Re-evaluate access without flushing messages or flashing a loading skeleton. */
async function refreshSpaceAccess(spaceId: string, current: () => boolean): Promise<void> {
  const spaces = useSpaceStore.getState(); if (!spaces.spaces.some(space => space.id === spaceId)) return;
  const known = [...spaces.channelToSpaceMap].filter(([, id]) => id === spaceId).map(([id]) => id);
  const visible = await spaces.loadSpaceDetail(spaceId, { quiet: true }); if (!visible || !current()) return;
  const listed = new Set(visible.map(channel => channel.id));
  for (const id of known) if (!listed.has(id)) handleEvent({ type: 'channel_deleted', channelId: id, spaceId }, true, current);
}

function connect(conn: Connection): void {
  if (!ownsSession(conn)) return;
  if (conn.ws && (conn.ws.readyState === WebSocket.OPEN || conn.ws.readyState === WebSocket.CONNECTING)) return;
  clearTimeout(conn.reconnectTimer); conn.reconnectTimer = undefined;
  const url = new URL('/ws', conn.origin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(url.toString()); conn.ws = ws;
  const current = () => ownsSession(conn) && conn.ws === ws;
  let readyDelivered = false;
  ws.onopen = () => {
    if (!current()) { ws.close(); return; }
    conn.reconnectAttempts = 0; ws.send(JSON.stringify({ type: 'auth', token: conn.token, client: detectClientKind() })); startHeartbeat(conn);
  };
  ws.onmessage = message => {
    if (!current()) return;
    let event: ServerEvent;
    try { event = JSON.parse(message.data as string) as ServerEvent; } catch { console.error('Failed to parse WebSocket message'); return; }
    if (!event || typeof event !== 'object' || typeof event.type !== 'string') return;
    const alreadyDelivered = readyDelivered; if (event.type === 'ready') readyDelivered = true;
    try { handleEvent(event, alreadyDelivered, current); } catch (error) { console.error('Error handling WS event "%s":', event.type, error); }
  };
  ws.onclose = event => {
    if (!current()) return;
    recordDiagnostic({ event: 'ws-closed', subsystem: 'websocket', level: event.code === 1000 ? 'info' : 'warning', reason: event.code });
    conn.ws = null; stopHeartbeat(conn);
    const delay = Math.min(1000 * 2 ** conn.reconnectAttempts, 30000); conn.reconnectAttempts++;
    recordDiagnostic({ event: 'ws-reconnect', subsystem: 'websocket', level: 'warning', attempt: conn.reconnectAttempts });
    conn.reconnectTimer = setTimeout(() => connect(conn), delay);
  };
  ws.onerror = () => { if (current()) ws.close(); };
}
/** Read signaling state without acquiring ownership of the connection. */
export function getWsConnected(): boolean {
  return connection !== null && ownsSession(connection) && connection.ws?.readyState === WebSocket.OPEN;
}
/** False means not handed to an open socket: callers must not count it as sent. */
export function wsSend(event: ClientEvent): boolean {
  if (!connection || !ownsSession(connection) || connection.ws?.readyState !== WebSocket.OPEN) return false;
  connection.ws.send(JSON.stringify(event)); return true;
}
/** The top-level app owns the single current-server socket and its timers. */
export function useWebSocket() {
  const token = useAuthStore(state => state.token), revision = useAuthStore(state => state.sessionRevision);
  const [isConnected, setIsConnected] = useState(false);
  useEffect(() => {
    if (!token) { setIsConnected(false); return; }
    if (connection) disconnect(connection);
    const conn: Connection = { ws: null, heartbeatWorker: null, heartbeatUrl: null, reconnectAttempts: 0, reconnectTimer: undefined, token, revision, origin: window.location.origin };
    connection = conn; connect(conn);
    const timer = setInterval(() => setIsConnected(getWsConnected()), 500);
    return () => { clearInterval(timer); disconnect(conn); };
  }, [token, revision]);
  return { send: wsSend, isConnected };
}
