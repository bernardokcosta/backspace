import { create } from 'zustand';
import type { Space, Channel, ChannelCategory, MemberWithUser, SpaceWithChannelsAndMembers, Role, SpaceFolder,
  SpaceLayoutItem, DmChannel, User, UpdateSpaceRequest, CreateSpaceRequest, UpdateChannelRequest } from '@veyvox/shared';
import { DEFAULT_AFK_TIMEOUT_SECONDS } from '@veyvox/shared/src/constants';
import { api, HttpError } from '../api/client';
import { JoinRequestRequiredError } from '../utils/joinErrors';
import { sortDmChannels } from '../utils/dmSorting';
import { useAuthStore } from './authStore';
import { useChatStore } from './chatStore';
import { putChannels, putSpaceListings, dropChannels, replaceSpaceChannels, channelIdsWhere, deriveChannelLookups,
  type SpaceChannelIndex, type SpaceChannelTables } from './spaceChannels';

export type SpaceWithMyRoles = Space & { myRoleIds?: string[] };
export interface UserViewEntry { user: User; updatedAt: number }
type LayoutFolders = Record<string, { name: string | null; color: string | null; spaceIds: string[] }>;
type RosterChange = { kind: 'join'; member: MemberWithUser } | { kind: 'leave'; userId: string };
let generation = 0;
let detailRequestCount = 0;
const newestDetailRequests = new Map<string, { seq: number; result: Promise<Channel[] | undefined> }>();
const inFlightRosterLogs = new Map<string, Set<RosterChange[]>>();

function recordRosterChange(spaceId: string, change: RosterChange): void {
  for (const log of inFlightRosterLogs.get(spaceId) ?? []) log.push(change);
}
function applyRosterChange(members: MemberWithUser[], change: RosterChange): MemberWithUser[] {
  return change.kind === 'join'
    ? [...members.filter(member => member.userId !== change.member.userId), change.member]
    : members.filter(member => member.userId !== change.userId);
}
function replayRosterChange(members: MemberWithUser[], change: RosterChange): MemberWithUser[] {
  return change.kind === 'join' && members.some(member => member.userId === change.member.userId) ? members : applyRosterChange(members, change);
}
function byPosition<T extends { position: number }>(rows: readonly T[]): T[] { return [...rows].sort((a, b) => a.position - b.position); }
function assertCurrent(expected: number): void { if (generation !== expected) throw new DOMException('', 'AbortError'); }

interface SpaceState {
  spaces: SpaceWithMyRoles[];
  currentSpaceId: string | null;
  /** Survives navigation to DMs; cleared only when removed or on session reset. */
  lastSelectedSpaceId: string | null;
  channels: Channel[];
  categories: ChannelCategory[];
  members: MemberWithUser[];
  roles: Role[];
  folders: SpaceFolder[];
  spaceLayout: SpaceLayoutItem[] | null;
  dmChannels: DmChannel[];
  spaceChannelIndex: SpaceChannelIndex;
  channelToSpaceMap: ReadonlyMap<string, string>;
  channelLastMessageIds: ReadonlyMap<string, string>;
  spacePermissions: ReadonlyMap<string, string>;
  channelPermissions: ReadonlyMap<string, string>;
  voiceChannelIds: ReadonlySet<string>;
  userViews: ReadonlyMap<string, UserViewEntry>;
  loadingSpaceId: string | null;
  loadedSpaceIds: ReadonlySet<string>;
  _layoutUpdatedAt: number;
  setSpaces: (spaces: SpaceWithMyRoles[]) => void;
  setCurrentSpace: (spaceId: string | null) => void;
  setChannels: (channels: Channel[]) => void;
  setCategories: (categories: ChannelCategory[]) => void;
  setMembers: (members: MemberWithUser[]) => void;
  setRoles: (roles: Role[]) => void;
  upsertDmChannel: (channel: DmChannel) => string;
  patchDmChannel: (channelId: string, patch: (channel: DmChannel) => DmChannel) => void;
  resortDmChannels: (currentChannelId?: string | null) => void;
  reloadDms: () => Promise<void>;
  removeDmChannel: (id: string) => void;
  addDmMember: (dmChannelId: string, user: User) => void;
  removeDmMember: (dmChannelId: string, userId: string) => void;
  updateDmOwner: (dmChannelId: string, newOwnerId: string) => void;
  updateDmMetadata: (dmChannelId: string, patch: { name?: string | null; icon?: string | null }) => void;
  closeDm: (id: string) => Promise<void>;
  leaveDm: (id: string) => Promise<void>;
  loadSpaces: () => Promise<void>;
  loadSpaceDetail: (spaceId: string, options?: { quiet?: boolean }) => Promise<Channel[] | undefined>;
  createSpace: (data: CreateSpaceRequest) => Promise<Space>;
  updateSpace: (spaceId: string, data: UpdateSpaceRequest) => Promise<void>;
  deleteSpace: (spaceId: string) => Promise<void>;
  joinSpace: (spaceId: string, inviteCode: string) => Promise<void>;
  leaveSpace: (spaceId: string) => Promise<void>;
  joinByCode: (inviteCode: string) => Promise<Space>;
  generateInvite: (spaceId: string) => Promise<string>;
  createChannel: (spaceId: string, name: string, type: 'text' | 'voice', topic?: string, categoryId?: string) => Promise<Channel>;
  upsertChannel: (channel: Channel, spaceId: string) => void;
  removeChannel: (channelId: string) => void;
  applyChannelLayout: (spaceId: string, channels: Channel[], categories: ChannelCategory[]) => void;
  upsertCategory: (category: ChannelCategory) => void;
  removeCategory: (categoryId: string, spaceId: string) => void;
  updateChannel: (channelId: string, data: UpdateChannelRequest) => Promise<Channel>;
  deleteChannel: (channelId: string) => Promise<void>;
  createCategory: (spaceId: string, name: string) => Promise<ChannelCategory>;
  updateCategory: (categoryId: string, data: { name?: string; position?: number }) => Promise<ChannelCategory>;
  deleteCategory: (categoryId: string) => Promise<void>;
  updateChannelLayout: (spaceId: string, data: { channels: Array<{ id: string; position: number; categoryId: string | null }>; categories: Array<{ id: string; position: number }> }) => Promise<void>;
  addSpace: (space: Space) => void;
  removeSpace: (spaceId: string) => void;
  updateMemberPresence: (userId: string, status: User['status']) => void;
  updateUserEverywhere: (user: User) => void;
  addMember: (spaceId: string, member: MemberWithUser) => void;
  removeMember: (spaceId: string, userId: string) => void;
  setSpaceLayout: (layout: SpaceLayoutItem[] | null) => void;
  updateSpaceLayout: (items: SpaceLayoutItem[], folders: LayoutFolders) => Promise<void>;
  populateFromReady: (spaces: SpaceWithChannelsAndMembers[], folders?: SpaceFolder[], dmChannels?: DmChannel[], spaceLayout?: SpaceLayoutItem[] | null, layoutUpdatedAt?: number) => void;
  upsertUserView: (user: User) => void;
  addSpaceFromReady: (space: SpaceWithChannelsAndMembers) => void;
  transferOwnership: (spaceId: string, newOwnerId: string) => Promise<void>;
  findExistingDmForUser: (userId: string) => DmChannel | null;
  reset: () => void;
}

function channelTablesOf(state: SpaceState): SpaceChannelTables {
  return { index: state.spaceChannelIndex, permissions: state.channelPermissions, lastMessageIds: state.channelLastMessageIds };
}
function channelTableFields(state: SpaceState, tables: SpaceChannelTables): Partial<SpaceState> {
  if (tables.index === state.spaceChannelIndex && tables.permissions === state.channelPermissions && tables.lastMessageIds === state.channelLastMessageIds) return {};
  return { spaceChannelIndex: tables.index, channelPermissions: tables.permissions, channelLastMessageIds: tables.lastMessageIds, ...deriveChannelLookups(tables.index) };
}
function dmFields(state: SpaceState, channels: DmChannel[]): Pick<SpaceState, 'dmChannels' | 'channelLastMessageIds'> {
  const channelLastMessageIds = new Map(state.channelLastMessageIds);
  for (const dm of state.dmChannels) channelLastMessageIds.delete(dm.id);
  for (const dm of channels) if (dm.lastMessage?.id) channelLastMessageIds.set(dm.id, dm.lastMessage.id);
  const chat = useChatStore.getState();
  return { dmChannels: sortDmChannels(channels, chat.unreadChannels, chat.currentChannelId), channelLastMessageIds };
}
function summary(space: SpaceWithChannelsAndMembers): SpaceWithMyRoles {
  return { id: space.id, name: space.name, icon: space.icon, banner: space.banner,
    avatarColor: space.avatarColor, ownerId: space.ownerId, ownerTitle: space.ownerTitle,
    inviteCode: space.inviteCode, visibility: space.visibility, description: space.description,
    createdAt: space.createdAt, afkChannelId: space.afkChannelId ?? null,
    afkTimeoutSeconds: space.afkTimeoutSeconds ?? DEFAULT_AFK_TIMEOUT_SECONDS,
    myRoleIds: space.members.find(member => member.userId === useAuthStore.getState().user?.id)?.roles.map(role => role.id) ?? [] };
}
function initialState() {
  return { spaces: [] as SpaceWithMyRoles[], currentSpaceId: null as string | null, lastSelectedSpaceId: null as string | null,
    channels: [] as Channel[], categories: [] as ChannelCategory[], members: [] as MemberWithUser[], roles: [] as Role[],
    folders: [] as SpaceFolder[], spaceLayout: null as SpaceLayoutItem[] | null, dmChannels: [] as DmChannel[],
    spaceChannelIndex: new Map<string, { spaceId: string; type: Channel['type'] }>(), channelToSpaceMap: new Map<string, string>(),
    channelLastMessageIds: new Map<string, string>(), spacePermissions: new Map<string, string>(), channelPermissions: new Map<string, string>(),
    voiceChannelIds: new Set<string>(), userViews: new Map<string, UserViewEntry>(), loadingSpaceId: null as string | null,
    loadedSpaceIds: new Set<string>(), _layoutUpdatedAt: 0 };
}

export const useSpaceStore = create<SpaceState>((set, get) => ({
  ...initialState(),
  reset: () => { generation++; newestDetailRequests.clear(); inFlightRosterLogs.clear(); set(initialState()); },
  setSpaces: spaces => set({ spaces }),
  setCurrentSpace: currentSpaceId => set(state => ({ currentSpaceId, lastSelectedSpaceId: currentSpaceId ?? state.lastSelectedSpaceId })),
  setChannels: channels => set({ channels }), setCategories: categories => set({ categories }),
  setMembers: members => set({ members }), setRoles: roles => set({ roles }),

  upsertDmChannel: channel => {
    set(state => dmFields(state, state.dmChannels.some(dm => dm.id === channel.id)
      ? state.dmChannels.map(dm => dm.id === channel.id ? channel : dm) : [...state.dmChannels, channel]));
    for (const member of channel.members) get().upsertUserView(member);
    return channel.id;
  },
  patchDmChannel: (channelId, patch) => set(state => {
    let changed = false;
    const rows = state.dmChannels.map(dm => { const next = dm.id === channelId ? patch(dm) : dm; if (next !== dm) changed = true; return next; });
    return changed ? dmFields(state, rows) : state;
  }),
  resortDmChannels: currentChannelId => set(state => {
    if (state.dmChannels.length === 0) return state;
    const chat = useChatStore.getState();
    return { dmChannels: sortDmChannels(state.dmChannels, chat.unreadChannels, currentChannelId === undefined ? chat.currentChannelId : currentChannelId) };
  }),
  reloadDms: async () => {
    const current = generation;
    const channels = await api.dm.list();
    if (current !== generation) return;
    set(state => dmFields(state, channels));
    for (const dm of channels) for (const member of dm.members) get().upsertUserView(member);
  },
  upsertUserView: user => set(state => {
    const userViews = new Map(state.userViews); userViews.set(user.id, { user, updatedAt: Date.now() }); return { userViews };
  }),
  removeDmChannel: id => {
    set(state => dmFields(state, state.dmChannels.filter(dm => dm.id !== id)));
    useChatStore.getState().removeChannelStates(new Set([id]));
  },
  addDmMember: (id, user) => get().patchDmChannel(id, dm => dm.members.some(member => member.id === user.id) ? dm : { ...dm, members: [...dm.members, user] }),
  removeDmMember: (id, userId) => get().patchDmChannel(id, dm => ({ ...dm, members: dm.members.filter(member => member.id !== userId) })),
  updateDmOwner: (id, ownerId) => get().patchDmChannel(id, dm => ({ ...dm, ownerId })),
  updateDmMetadata: (id, patch) => get().patchDmChannel(id, dm => ({ ...dm,
    ...('name' in patch ? { name: patch.name ?? null } : {}), ...('icon' in patch ? { icon: patch.icon ?? null } : {}) })),
  closeDm: async id => { const current = generation; await api.dm.close(id); if (current === generation) get().removeDmChannel(id); },
  leaveDm: async id => { const current = generation; await api.dm.leave(id); if (current === generation) get().removeDmChannel(id); },

  loadSpaces: async () => {
    const current = generation;
    try { const spaces = await api.spaces.list(); if (current === generation) set({ spaces }); } catch { /* Ready also populates memberships. */ }
  },
  loadSpaceDetail: (spaceId, options) => {
    const current = generation, seq = ++detailRequestCount;
    const overtaken = () => newestDetailRequests.get(spaceId)?.seq !== seq;
    const newestResult = () => current === generation ? newestDetailRequests.get(spaceId)?.result ?? Promise.resolve(undefined) : Promise.resolve(undefined);
    const endLoading = (state: SpaceState) => state.loadingSpaceId === spaceId ? null : state.loadingSpaceId;
    const result = (async (): Promise<Channel[] | undefined> => {
      const rosterChanges: RosterChange[] = [];
      try {
        if (!get().spaces.some(space => space.id === spaceId)) return;
        if (!options?.quiet) set({ loadingSpaceId: spaceId });
        const logs = inFlightRosterLogs.get(spaceId) ?? new Set<RosterChange[]>(); logs.add(rosterChanges); inFlightRosterLogs.set(spaceId, logs);
        const detail = await api.spaces.get(spaceId);
        if (current !== generation) return;
        if (overtaken()) return newestResult();
        for (const member of detail.members) get().upsertUserView(member.user);
        let dropped: string[] = [];
        set(state => {
          const replaced = replaceSpaceChannels(channelTablesOf(state), spaceId, detail.channels); dropped = replaced.dropped;
          const spacePermissions = new Map(state.spacePermissions); if (detail.myPermissions) spacePermissions.set(spaceId, detail.myPermissions);
          const fields = { ...channelTableFields(state, replaced.tables), spacePermissions, loadingSpaceId: endLoading(state),
            spaces: state.spaces.map(space => space.id === spaceId ? { ...space, myRoleIds: summary(detail).myRoleIds } : space) };
          if (state.currentSpaceId !== spaceId) return fields;
          const loadedSpaceIds = new Set(state.loadedSpaceIds); loadedSpaceIds.add(spaceId);
          return { ...fields, lastSelectedSpaceId: spaceId, channels: byPosition(detail.channels), categories: byPosition(detail.categories ?? []),
            members: rosterChanges.reduce(replayRosterChange, detail.members), roles: [...detail.roles].sort((a, b) => b.position - a.position), loadedSpaceIds };
        });
        if (dropped.length) useChatStore.getState().removeChannelStates(new Set(dropped));
        return detail.channels;
      } catch {
        if (current !== generation) return;
        if (overtaken()) return newestResult();
        set(state => ({ loadingSpaceId: endLoading(state) })); return;
      } finally {
        const logs = inFlightRosterLogs.get(spaceId); logs?.delete(rosterChanges); if (logs?.size === 0) inFlightRosterLogs.delete(spaceId);
      }
    })();
    newestDetailRequests.set(spaceId, { seq, result }); return result;
  },
  createSpace: async data => { const current = generation; const space = await api.spaces.create(data); assertCurrent(current); get().addSpace(space); return space; },
  updateSpace: async (id, data) => {
    const current = generation, updated = await api.spaces.update(id, data);
    if (current === generation) set(state => ({ spaces: state.spaces.map(space => space.id === id ? { ...space, ...updated } : space) }));
  },
  deleteSpace: async id => { const current = generation; await api.spaces.delete(id); if (current === generation) get().removeSpace(id); },
  leaveSpace: async id => {
    const current = generation, userId = useAuthStore.getState().user?.id; if (!userId) return;
    await api.spaces.removeMember(id, userId); if (current === generation) get().removeSpace(id);
  },
  joinSpace: async (id, inviteCode) => { const current = generation; const space = await api.spaces.join(id, { inviteCode }); if (current === generation) get().addSpace(space); },
  joinByCode: async inviteCode => {
    const current = generation;
    try {
      const space = await api.spaces.joinByCode(inviteCode); assertCurrent(current); get().addSpace(space); return space;
    } catch (error) {
      assertCurrent(current);
      if (!(error instanceof HttpError) || error.code !== 'join_request_required') throw error;
      const id = error.details?.spaceId;
      if (typeof id === 'string' && id) throw new JoinRequestRequiredError(error, id);
      let preview;
      try { preview = await api.spaces.invitePreview(inviteCode); } catch { throw error; }
      assertCurrent(current); throw new JoinRequestRequiredError(error, preview.spaceId);
    }
  },
  generateInvite: async id => { const current = generation; const result = await api.spaces.invite(id); assertCurrent(current); return result.inviteCode; },

  createChannel: async (spaceId, name, type, topic, categoryId) => {
    const current = generation, channel = await api.channels.create(spaceId, { name, type, topic, categoryId }); assertCurrent(current);
    get().upsertChannel(channel, spaceId); return channel;
  },
  upsertChannel: (channel, spaceId) => set(state => {
    const fields = channelTableFields(state, putChannels(channelTablesOf(state), spaceId, [channel]));
    if (state.currentSpaceId !== spaceId) return fields;
    return { ...fields, channels: byPosition(state.channels.some(row => row.id === channel.id)
      ? state.channels.map(row => row.id === channel.id ? channel : row) : [...state.channels, channel]) };
  }),
  removeChannel: channelId => {
    set(state => ({ ...channelTableFields(state, dropChannels(channelTablesOf(state), [channelId])), channels: state.channels.filter(row => row.id !== channelId) }));
    useChatStore.getState().removeChannelStates(new Set([channelId]));
  },
  applyChannelLayout: (spaceId, channels, categories) => {
    let dropped: string[] = [];
    set(state => {
      const replaced = replaceSpaceChannels(channelTablesOf(state), spaceId, channels); dropped = replaced.dropped;
      const fields = channelTableFields(state, replaced.tables);
      return state.currentSpaceId === spaceId ? { ...fields, channels: byPosition(channels), categories: byPosition(categories) } : fields;
    });
    if (dropped.length) useChatStore.getState().removeChannelStates(new Set(dropped));
  },
  upsertCategory: category => set(state => state.currentSpaceId !== category.spaceId ? state : { categories: byPosition(
    state.categories.some(row => row.id === category.id) ? state.categories.map(row => row.id === category.id ? category : row) : [...state.categories, category]) }),
  removeCategory: (categoryId, spaceId) => set(state => state.currentSpaceId !== spaceId ? state : {
    categories: state.categories.filter(row => row.id !== categoryId), channels: state.channels.map(row => row.categoryId === categoryId ? { ...row, categoryId: null } : row),
  }),
  updateChannel: async (id, data) => { const current = generation, channel = await api.channels.update(id, data); assertCurrent(current); get().upsertChannel(channel, channel.spaceId); return channel; },
  deleteChannel: async id => { const current = generation; await api.channels.delete(id); if (current === generation) get().removeChannel(id); },
  createCategory: async (id, name) => { const current = generation, category = await api.categories.create(id, name); assertCurrent(current); get().upsertCategory(category); return category; },
  updateCategory: async (id, data) => { const current = generation, category = await api.categories.update(id, data); assertCurrent(current); get().upsertCategory(category); return category; },
  deleteCategory: async id => { await api.categories.delete(id); }, // Category/channel events apply the server's uncategorized layout.
  updateChannelLayout: async (id, data) => { await api.channels.updateLayout(id, data); },
  addSpace: space => set(state => state.spaces.some(row => row.id === space.id) ? state : { spaces: [...state.spaces, space] }),
  removeSpace: id => {
    const removed = new Set(channelIdsWhere(get().spaceChannelIndex, entry => entry.spaceId === id));
    set(state => {
      const spacePermissions = new Map(state.spacePermissions); spacePermissions.delete(id);
      const loadedSpaceIds = new Set(state.loadedSpaceIds); loadedSpaceIds.delete(id);
      return { ...channelTableFields(state, dropChannels(channelTablesOf(state), removed)), spaces: state.spaces.filter(space => space.id !== id), spacePermissions, loadedSpaceIds,
        currentSpaceId: state.currentSpaceId === id ? null : state.currentSpaceId, lastSelectedSpaceId: state.lastSelectedSpaceId === id ? null : state.lastSelectedSpaceId };
    });
    if (removed.size) useChatStore.getState().removeChannelStates(removed);
  },

  updateMemberPresence: (userId, status) => {
    set(state => {
      const userViews = new Map(state.userViews), entry = userViews.get(userId);
      if (entry) userViews.set(userId, { ...entry, user: { ...entry.user, status } });
      return { userViews, members: state.members.map(member => member.userId === userId ? { ...member, user: { ...member.user, status } } : member),
        dmChannels: state.dmChannels.map(dm => dm.members.some(member => member.id === userId)
          ? { ...dm, members: dm.members.map(member => member.id === userId ? { ...member, status } : member) } : dm) };
    });
  },
  updateUserEverywhere: user => {
    get().upsertUserView(user);
    set(state => ({ members: state.members.map(member => member.userId === user.id ? { ...member, user: { ...member.user, ...user } } : member),
      dmChannels: state.dmChannels.map(dm => dm.members.some(member => member.id === user.id)
        ? { ...dm, members: dm.members.map(member => member.id === user.id ? { ...member, ...user } : member) } : dm) }));
  },
  addMember: (spaceId, member) => {
    const change: RosterChange = { kind: 'join', member }; recordRosterChange(spaceId, change);
    set(state => state.currentSpaceId === spaceId ? { members: applyRosterChange(state.members, change) } : state);
  },
  removeMember: (spaceId, userId) => {
    const change: RosterChange = { kind: 'leave', userId }; recordRosterChange(spaceId, change);
    set(state => state.currentSpaceId === spaceId ? { members: applyRosterChange(state.members, change) } : state);
  },
  setSpaceLayout: spaceLayout => set({ spaceLayout }),
  updateSpaceLayout: async (items, folders) => {
    const current = generation, now = Date.now(); set({ spaceLayout: items, _layoutUpdatedAt: now });
    const resolved = await api.spaceLayout.update({ items, folders, updatedAt: now });
    if (current === generation && (resolved.updatedAt ?? now) >= get()._layoutUpdatedAt) set({ spaceLayout: resolved.items, folders: resolved.folders, _layoutUpdatedAt: resolved.updatedAt ?? now });
  },
  populateFromReady: (spaces, folders = [], dmChannels = [], spaceLayout, layoutUpdatedAt) => {
    const current = get();
    const tables = putSpaceListings({ index: new Map(), permissions: new Map(), lastMessageIds: new Map() }, spaces);
    const spacePermissions = new Map<string, string>(); for (const space of spaces) if (space.myPermissions) spacePermissions.set(space.id, space.myPermissions);
    const view = dmFields({ ...current, channelLastMessageIds: tables.lastMessageIds }, dmChannels);
    const incomingTs = layoutUpdatedAt ?? 0;
    set({ ...channelTableFields(current, tables), ...view, spaces: spaces.map(summary), spacePermissions,
      ...(incomingTs >= current._layoutUpdatedAt ? { folders, ...(spaceLayout !== undefined ? { spaceLayout } : {}), _layoutUpdatedAt: incomingTs } : {}) });
    for (const space of spaces) for (const member of space.members) get().upsertUserView(member.user);
    for (const dm of dmChannels) for (const member of dm.members) get().upsertUserView(member);
  },
  addSpaceFromReady: space => {
    let dropped: string[] = [];
    set(state => {
      const replaced = replaceSpaceChannels(channelTablesOf(state), space.id, space.channels); dropped = replaced.dropped;
      const spacePermissions = new Map(state.spacePermissions); if (space.myPermissions) spacePermissions.set(space.id, space.myPermissions);
      return { ...channelTableFields(state, replaced.tables), spaces: [...state.spaces.filter(row => row.id !== space.id), summary(space)], spacePermissions };
    });
    for (const member of space.members) get().upsertUserView(member.user);
    if (dropped.length) useChatStore.getState().removeChannelStates(new Set(dropped));
  },
  transferOwnership: async (id, newOwnerId) => {
    const current = generation, updated = await api.spaces.transferOwnership(id, newOwnerId);
    if (current === generation) set(state => ({ spaces: state.spaces.map(space => space.id === id ? { ...space, ...updated } : space) }));
  },
  findExistingDmForUser: userId => {
    const self = useAuthStore.getState().user?.id;
    if (!self || self === userId) return null;
    return get().dmChannels.find(dm => dm.ownerId === null && dm.members.length === 2 && dm.members.some(member => member.id === self) && dm.members.some(member => member.id === userId)) ?? null;
  },
}));

export type ChannelKind = 'space' | 'dm' | 'unknown';
function channelKindIn(state: Pick<SpaceState, 'spaceChannelIndex' | 'dmChannels'>, channelId: string): ChannelKind {
  return state.spaceChannelIndex.has(channelId) ? 'space' : state.dmChannels.some(dm => dm.id === channelId) ? 'dm' : 'unknown';
}
export function getChannelKind(channelId: string): ChannelKind { return channelKindIn(useSpaceStore.getState(), channelId); }
export function isDmChannel(channelId: string): boolean { return getChannelKind(channelId) === 'dm'; }
export function useIsDmChannel(channelId: string): boolean | undefined {
  const kind = useSpaceStore(state => channelKindIn(state, channelId)); return kind === 'unknown' ? undefined : kind === 'dm';
}
export function selectMyRoleIdsInChannel(state: Pick<SpaceState, 'spaces' | 'channelToSpaceMap'>, channelId: string): readonly string[] | undefined {
  const spaceId = state.channelToSpaceMap.get(channelId);
  return spaceId === undefined ? undefined : state.spaces.find(space => space.id === spaceId)?.myRoleIds;
}
