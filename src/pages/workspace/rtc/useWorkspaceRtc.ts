import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type ComputedRef,
  type Ref,
} from 'vue';
import type { AuthSession } from '../../../services/auth/auth';
import type { createChatStore } from '../../../services/chat/chat';
import type { Conversation } from '../../../../shared/storage/database';
import type { GroupMemberItem } from '../../../../shared/contacts/group';
import type { FriendProfileRtcCallRequest } from '../../../../shared/contacts/friend-profile';
import type {
  HistoryRtcCallRequest,
  ResourceSseMessage,
} from '../../../../shared/windows/desktop';
import {
  parseRtcEvent,
  rtcActionVersion,
  RtcCallState,
  RtcEventType,
  RtcMediaMode,
  RtcDeviceOwnership,
  RtcParticipantState,
  type RtcCallView,
  type RtcOngoingCall,
} from '../../../../shared/rtc/rtc';
import { readRtcError } from '../../rtc/services/rtc-error';
import { getRequestErrorMessage } from '../../../../shared/api/api-error';

interface WorkspaceRtcOptions {
  store: Pick<ReturnType<typeof createChatStore>, 'listGroupMembers'>;
  getSession: () => AuthSession | Pick<AuthSession, 'user'>;
  isReadOnly: () => boolean;
  isDetached: () => boolean;
  isDisposed: () => boolean;
  offlineMode: Readonly<Ref<boolean>>;
  activeId: Readonly<Ref<string>>;
  activeConversation: Readonly<Ref<Conversation | undefined>>;
  conversations: Readonly<Ref<Conversation[]>>;
  error: Ref<string>;
  selectConversation: (conversation: Conversation) => Promise<void>;
  openSearchedFriend: (uid: string) => Promise<void>;
}

interface WorkspaceRtc {
  rtcRedialDialogOpen: Ref<boolean>;
  resolveRtcRedial: (confirmed: boolean) => void;
  rtcRecovery: ComputedRef<RtcOngoingCall | null>;
  rtcRecoveryBusy: Ref<boolean>;
  rtcRecoveryError: Ref<string>;
  recoverRtcCall: (reconnect: boolean) => Promise<void>;
  refreshRtcRecovery: () => Promise<void>;
  dismissRtcRecoveryError: () => void;
  canStartRtcCall: ComputedRef<boolean>;
  rtcInviteDialogOpen: Ref<boolean>;
  rtcInviteMembers: Ref<GroupMemberItem[]>;
  rtcInviteLoading: Ref<boolean>;
  rtcInviteBusy: Ref<boolean>;
  rtcInviteError: Ref<string>;
  cancelRtcInviteDialog: () => void;
  confirmRtcInvite: (participantUids: string[]) => Promise<void>;
  startRtcCall: (
    mediaMode: RtcMediaMode,
    participantUids?: string[],
  ) => Promise<boolean>;
  handleRtcWindowSse: (raw: ResourceSseMessage) => void;
}

/** 管理工作台通话入口、群成员邀请、历史回拨及独立通话窗口状态，复用工作台的资源 SSE。 */
export const useWorkspaceRtc = (options: WorkspaceRtcOptions): WorkspaceRtc => {
  const {
    store,
    getSession,
    isReadOnly,
    isDetached,
    offlineMode,
    activeId,
    activeConversation,
    conversations,
    error,
    selectConversation,
    openSearchedFriend,
  } = options;
  let stopped = false;
  /** 判断工作台或当前通话模块是否已停止处理事件。 */
  const isDisposed = (): boolean => stopped || options.isDisposed();
  const rtcCall = shallowRef<RtcCallView | null>(null);
  const rtcBusy = ref(false);
  const rtcRedialDialogOpen = ref(false);
  let resolveRedial: ((confirmed: boolean) => void) | undefined;
  let rtcDialVersion = 0;

  /** 完成本次渲染层确认，重复点击和关闭只处理一次。 */
  const resolveRtcRedial = (confirmed: boolean): void => {
    const resolve = resolveRedial;
    resolveRedial = undefined;
    rtcRedialDialogOpen.value = false;
    resolve?.(confirmed);
  };

  /** 打开应用内确认框，等待用户选择后继续当前呼出。 */
  const confirmRtcRedial = (): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      resolveRedial = resolve;
      rtcRedialDialogOpen.value = true;
    });
  const rtcRecoveries = shallowRef<RtcOngoingCall[]>([]);
  const rtcRecoveryBusy = ref(false);
  const rtcRecoveryError = ref('');
  let recoveryChecked = false;
  let unsubscribeRecoveryStatus: (() => void) | undefined;
  const rtcRecovery = computed((): RtcOngoingCall | null =>
    rtcCall.value ? null : (rtcRecoveries.value[0] ?? null),
  );

  /** 登录身份有效后只读发现未结束的单聊，网络失败允许重试。 */
  const refreshRtcRecovery = async (): Promise<void> => {
    if (
      isDisposed() ||
      isReadOnly() ||
      isDetached() ||
      offlineMode.value ||
      !window.desktop ||
      rtcRecoveryBusy.value ||
      rtcCall.value
    )
      return;
    const session = getSession();
    rtcRecoveryBusy.value = true;
    rtcRecoveryError.value = '';
    try {
      const calls = await window.desktop.rtcGetOngoingCalls();
      if (isDisposed() || getSession() !== session || isReadOnly()) return;
      rtcRecoveries.value = calls;
      recoveryChecked = true;
    } catch (cause) {
      if (!isDisposed() && getSession() === session && !isReadOnly())
        rtcRecoveryError.value = readRtcError(
          cause,
          '未结束通话查询失败，请重试',
        );
    } finally {
      if (!isDisposed() && getSession() === session)
        rtcRecoveryBusy.value = false;
    }
  };

  /** 查询失败提示可暂时收起，下次网络恢复仍补查。 */
  const dismissRtcRecoveryError = (): void => {
    if (!rtcRecovery.value && !rtcRecoveryBusy.value)
      rtcRecoveryError.value = '';
  };

  /** 重连先复核状态；主动挂断直接提交，由服务端按最新状态终止并重试冲突。 */
  const recoverRtcCall = async (reconnect: boolean): Promise<void> => {
    const recovery = rtcRecovery.value;
    if (
      !recovery ||
      !window.desktop ||
      rtcRecoveryBusy.value ||
      isReadOnly() ||
      isDisposed()
    )
      return;
    const session = getSession();
    const callId = recovery.call.callId;
    rtcRecoveryBusy.value = true;
    rtcRecoveryError.value = '';
    try {
      if (reconnect) {
        const latest = await window.desktop.rtcGetCall(callId);
        if (isDisposed() || getSession() !== session || isReadOnly()) return;
        if (!isRtcTerminal(latest)) {
          rtcCall.value = latest;
          await window.desktop.resumeRtcCall(callId);
          if (isDisposed() || getSession() !== session || isReadOnly()) return;
        }
      } else {
        const ended = await window.desktop.rtcHangupCall(
          callId,
          globalThis.crypto.randomUUID().replace(/-/g, ''),
          recovery.call.version,
        );
        if (!isRtcTerminal(ended)) throw new Error('服务端尚未确认结束通话');
      }
      if (isDisposed() || getSession() !== session || isReadOnly()) return;
      rtcRecoveries.value = rtcRecoveries.value.filter(
        (item) => item.call.callId !== callId,
      );
    } catch (cause) {
      if (!isDisposed() && getSession() === session && !isReadOnly()) {
        if (rtcCall.value?.callId === callId) rtcCall.value = null;
        rtcRecoveryError.value = readRtcError(
          cause,
          '通话恢复操作失败，请重试',
        );
        // 恢复失败可能伴随服务端已提交的强制结束，只读复核，不再提交挂断。
        try {
          const latest = await window.desktop.rtcGetCall(callId);
          if (
            !isDisposed() &&
            getSession() === session &&
            !isReadOnly() &&
            isRtcTerminal(latest)
          )
            rtcRecoveries.value = rtcRecoveries.value.filter(
              (item) => item.call.callId !== callId,
            );
        } catch {
          // 查询失败保留当前提示，下次 SSE 或登录查询继续收敛。
        }
      }
    } finally {
      if (!isDisposed() && getSession() === session)
        rtcRecoveryBusy.value = false;
    }
  };
  const profileCallPending = ref(false);
  const rtcInviteDialogOpen = ref(false);
  const rtcInviteMembers = shallowRef<GroupMemberItem[]>([]);
  const rtcInviteLoading = ref(false);
  const rtcInviteBusy = ref(false);
  const rtcInviteError = ref('');
  let rtcInviteRequestVersion = 0;
  let rtcDismissTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeRtcCallClosed: (() => void) | undefined;
  let unsubscribeHistoryRtcCall: (() => void) | undefined;
  let unsubscribeFriendProfileCall: (() => void) | undefined;
  const RTC_CALL_DISMISS_DELAY_MS = 1000;

  /** 判断当前会话是否允许发起音视频通话。*/
  const canStartRtcCall = computed(
    (): boolean =>
      !isReadOnly() &&
      !offlineMode.value &&
      !isDetached() &&
      Boolean(activeId.value) &&
      (activeConversation.value?.type === 1 ||
        activeConversation.value?.type === 2) &&
      Boolean(window.desktop) &&
      !rtcBusy.value &&
      !profileCallPending.value &&
      !rtcInviteDialogOpen.value &&
      !rtcRecovery.value &&
      !rtcRecoveryBusy.value,
  );

  /** 判断 RTC 呼叫是否已经进入终态。*/
  const isRtcTerminal = (call: RtcCallView | null): boolean => {
    switch (call?.state) {
      case RtcCallState.REJECTED:
      case RtcCallState.CANCELED:
      case RtcCallState.ENDED:
      case RtcCallState.EXPIRED:
        return true;
      default:
        return false;
    }
  };

  /** 清理终态自动关闭计时器，避免迟到回调作用于下一通电话。*/
  const clearRtcCallDismissTimer = (): void => {
    if (rtcDismissTimer === undefined) return;
    clearTimeout(rtcDismissTimer);
    rtcDismissTimer = undefined;
  };

  /** 通话进入任一终态后一秒自动收起终态面板。*/
  const scheduleRtcCallDismiss = (callId: string): void => {
    clearRtcCallDismissTimer();
    rtcDismissTimer = setTimeout((): void => {
      rtcDismissTimer = undefined;
      if (rtcCall.value?.callId === callId && isRtcTerminal(rtcCall.value))
        dismissRtcCall();
    }, RTC_CALL_DISMISS_DELAY_MS);
  };

  /** 打开群通话成员选择弹窗，不在成员读取完成前创建 RTC 呼叫。 */
  const openRtcInviteDialog = async (): Promise<void> => {
    const conversation = activeConversation.value;
    const roomId = activeId.value;
    if (
      !roomId ||
      conversation?.type !== 1 ||
      isReadOnly() ||
      offlineMode.value ||
      isDetached() ||
      !window.desktop ||
      rtcBusy.value ||
      rtcRecovery.value ||
      rtcRecoveryBusy.value
    )
      return;
    const version = ++rtcInviteRequestVersion;
    rtcInviteMembers.value = [];
    rtcInviteLoading.value = true;
    rtcInviteError.value = '';
    rtcInviteDialogOpen.value = true;
    try {
      const members = await store.listGroupMembers(roomId);
      if (isDisposed() || version !== rtcInviteRequestVersion) return;
      rtcInviteMembers.value = members.filter(
        (member) => member.uid !== getSession().user.id,
      );
      if (!rtcInviteMembers.value.length)
        rtcInviteError.value = '当前群聊没有可邀请的成员';
    } catch (cause) {
      if (isDisposed() || version !== rtcInviteRequestVersion) return;
      rtcInviteError.value = getRequestErrorMessage(
        cause,
        '群成员读取失败，请重试',
      );
    } finally {
      if (!isDisposed() && version === rtcInviteRequestVersion)
        rtcInviteLoading.value = false;
    }
  };

  /** 仅通过弹窗底部取消按钮关闭群通话成员选择。 */
  const cancelRtcInviteDialog = (): void => {
    rtcInviteRequestVersion++;
    rtcInviteDialogOpen.value = false;
    rtcInviteLoading.value = false;
    rtcInviteBusy.value = false;
    rtcInviteMembers.value = [];
    rtcInviteError.value = '';
  };

  /** 提交弹窗中选中的成员，成功创建通话后才收起弹窗。 */
  const confirmRtcInvite = async (participantUids: string[]): Promise<void> => {
    if (!participantUids.length || rtcInviteBusy.value) return;
    rtcInviteBusy.value = true;
    rtcInviteError.value = '';
    try {
      const started = await startRtcCall(RtcMediaMode.AUDIO, participantUids);
      if (started) cancelRtcInviteDialog();
      else rtcInviteError.value = error.value;
    } finally {
      rtcInviteBusy.value = false;
    }
  };

  /** 群聊先发现并加入原通话，仅无活动通话时选择成员新建。 */
  const startRtcCall = async (
    mediaMode: RtcMediaMode,
    participantUids?: string[],
  ): Promise<boolean> => {
    const conversation = activeConversation.value;
    if (
      !activeId.value ||
      isReadOnly() ||
      offlineMode.value ||
      isDetached() ||
      rtcBusy.value ||
      rtcRecovery.value ||
      rtcRecoveryBusy.value ||
      !window.desktop
    )
      return false;
    const session = getSession();
    const roomId = activeId.value;
    const version = rtcDialVersion;
    /** 查询和确认结果仅能继续原账号、原会话的呼出。 */
    const isCurrentDial = (): boolean =>
      !isDisposed() &&
      getSession() === session &&
      !isReadOnly() &&
      !offlineMode.value &&
      activeId.value === roomId &&
      rtcDialVersion === version;
    rtcBusy.value = true;
    error.value = '';
    try {
      const groupCall =
        conversation?.type === 1
          ? await window.desktop.rtcGetGroupActiveCall(roomId)
          : null;
      if (!isCurrentDial()) return false;
      if (
        conversation?.type === 1 &&
        !groupCall &&
        participantUids === undefined
      ) {
        rtcBusy.value = false;
        await openRtcInviteDialog();
        return false;
      }
      const active = await window.desktop.rtcGetActiveCalls();
      if (!isCurrentDial()) return false;
      if (groupCall) {
        if (active.some((item) => item.callId !== groupCall.callId))
          throw new Error('请先结束其他通话后再加入');
        const ownState = groupCall.participants.find(
          (member) => member.uid === session.user.id,
        )?.state;
        let joined = groupCall;
        if (ownState === RtcParticipantState.ACCEPTED) {
          if (groupCall.deviceOwnership !== RtcDeviceOwnership.CURRENT_DEVICE)
            throw new Error('该群通话已在其他设备接听或设备归属未确认');
        } else {
          joined = await window.desktop.rtcAcceptCall(
            groupCall.callId,
            globalThis.crypto.randomUUID().replace(/-/g, ''),
            rtcActionVersion(groupCall, session.user.id),
          );
        }
        // 已提交的加入沿原账号完成窗口交接，避免切换聊天后留下无人承接的参与状态。
        if (isDisposed() || getSession() !== session || isReadOnly())
          return false;
        if (
          isRtcTerminal(joined) ||
          joined.deviceOwnership !== RtcDeviceOwnership.CURRENT_DEVICE ||
          !joined.participants.some(
            (member) =>
              member.uid === session.user.id &&
              member.state === RtcParticipantState.ACCEPTED,
          )
        )
          throw new Error('群通话未确认加入，请重试');
        clearRtcCallDismissTimer();
        rtcCall.value = joined;
        await window.desktop.openRtcCall(joined.callId);
        return true;
      }
      if (active.length > 0) {
        const confirmed = await confirmRtcRedial();
        if (!confirmed || !isCurrentDial()) return false;
      }
      // 群聊保留视频发布能力，独立窗口与控制器默认只采集语音。
      const call = await window.desktop.rtcCreateCall(
        roomId,
        conversation?.type === 1 ? RtcMediaMode.VIDEO : mediaMode,
        globalThis.crypto.randomUUID().replace(/-/g, ''),
        participantUids,
        active.map((item) => item.callId),
      );
      if (isDisposed() || getSession() !== session || isReadOnly())
        return false;
      clearRtcCallDismissTimer();
      rtcRecoveries.value = [];
      rtcRecoveryError.value = '';
      rtcCall.value = call;
      await window.desktop.openRtcCall(call.callId);
      return true;
    } catch (cause) {
      if (!isCurrentDial()) return false;
      error.value = readRtcError(cause, '通话发起失败，请重试');
      return false;
    } finally {
      rtcBusy.value = false;
    }
  };

  /** 释放工作台保留的通话引用并清理终态计时器。 */
  const dismissRtcCall = (): void => {
    clearRtcCallDismissTimer();
    rtcCall.value = null;
  };

  /** 同步主页面发起的独立通话终态。 */
  const handleRtcWindowSse = (raw: ResourceSseMessage): void => {
    if (isDisposed() || isReadOnly()) return;
    const event = parseRtcEvent(raw);
    if (event && event.toUid !== getSession().user.id) return;
    if (
      event &&
      [
        RtcEventType.RTC_CALL_REJECTED,
        RtcEventType.RTC_CALL_CANCELED,
        RtcEventType.RTC_CALL_ENDED,
        RtcEventType.RTC_CALL_EXPIRED,
      ].includes(event.eventType)
    ) {
      rtcRecoveries.value = rtcRecoveries.value.filter(
        (item) =>
          item.call.callId !== event.callId ||
          item.call.version > event.callVersion,
      );
      if (!rtcRecoveries.value.length) rtcRecoveryError.value = '';
    }
    const current = rtcCall.value;
    if (!event || !current || event.callId !== current.callId) return;
    switch (event.eventType) {
      case RtcEventType.RTC_CALL_REJECTED:
      case RtcEventType.RTC_CALL_CANCELED:
      case RtcEventType.RTC_CALL_ENDED:
      case RtcEventType.RTC_CALL_EXPIRED: {
        let state: RtcCallView['state'];
        switch (event.eventType) {
          case RtcEventType.RTC_CALL_REJECTED:
            state = RtcCallState.REJECTED;
            break;
          case RtcEventType.RTC_CALL_CANCELED:
            state = RtcCallState.CANCELED;
            break;
          case RtcEventType.RTC_CALL_EXPIRED:
            state = RtcCallState.EXPIRED;
            break;
          default:
            state = RtcCallState.ENDED;
            break;
        }
        rtcCall.value = { ...current, state, version: event.callVersion };
        scheduleRtcCallDismiss(current.callId);
        break;
      }
      default:
        break;
    }
  };

  /** 处理历史窗口回拨请求，切换到对应单聊后复用统一发起流程。 */
  const handleHistoryRtcCallRequest = async (
    request: HistoryRtcCallRequest,
  ): Promise<void> => {
    if (isDisposed() || isReadOnly() || isDetached()) return;
    const conversation = conversations.value.find(
      (item) => item.id === request.conversationId,
    );
    if (!conversation || conversation.type !== 2) {
      error.value = '当前会话不支持回拨';
      return;
    }
    if (activeId.value !== request.conversationId)
      await selectConversation(conversation);
    if (
      isDisposed() ||
      isReadOnly() ||
      activeId.value !== request.conversationId
    )
      return;
    await startRtcCall(request.mediaMode);
  };

  /** 从资料绑定的好友单聊发起通话，缺失会话时复用既有好友聊天恢复流程。 */
  const handleFriendProfileCallRequest = async (
    request: FriendProfileRtcCallRequest,
  ): Promise<void> => {
    if (
      isDisposed() ||
      isReadOnly() ||
      isDetached() ||
      profileCallPending.value
    )
      return;
    if (offlineMode.value) {
      error.value = '当前离线，无法发起通话';
      return;
    }
    if (rtcBusy.value || rtcInviteDialogOpen.value) {
      error.value = '请等待通话操作完成或关闭通话邀请';
      return;
    }
    const session = getSession();
    profileCallPending.value = true;
    try {
      const conversation = conversations.value.find(
        (item) => item.id === request.roomId,
      );
      if (conversation) {
        if (
          conversation.type !== 2 ||
          conversation.participantId !== request.uid
        )
          throw new Error('好友资料与当前聊天不匹配');
        if (activeId.value !== request.roomId)
          await selectConversation(conversation);
      } else {
        await openSearchedFriend(request.uid);
      }
      if (isDisposed() || isReadOnly() || getSession() !== session) return;
      if (
        activeId.value !== request.roomId ||
        activeConversation.value?.type !== 2 ||
        activeConversation.value.participantId !== request.uid
      )
        return;
      if (rtcInviteDialogOpen.value) return;
      await startRtcCall(request.mediaMode);
    } catch (cause) {
      if (!isDisposed() && !isReadOnly() && getSession() === session)
        error.value = readRtcError(cause, '通话发起失败，请重试');
    } finally {
      profileCallPending.value = false;
    }
  };

  onMounted((): void => {
    void refreshRtcRecovery();
    unsubscribeRecoveryStatus = window.desktop?.onResourceStatus(
      (status): void => {
        if (status === 'connected' && !recoveryChecked)
          void refreshRtcRecovery();
      },
    );
    unsubscribeRtcCallClosed = window.desktop?.onRtcCallClosed(
      (callId): void => {
        if (isDisposed() || rtcCall.value?.callId !== callId) return;
        dismissRtcCall();
      },
    );
    unsubscribeHistoryRtcCall = window.desktop?.onHistoryRtcCallRequested(
      (request): void => {
        void handleHistoryRtcCallRequest(request);
      },
    );
    unsubscribeFriendProfileCall = window.desktop?.onFriendProfileCallRequested(
      (request): void => {
        void handleFriendProfileCallRequest(request);
      },
    );
  });

  watch([offlineMode, isReadOnly], ([offline, readOnly]): void => {
    if (!offline && !readOnly && !recoveryChecked) void refreshRtcRecovery();
  });

  watch(
    [activeId, getSession, isReadOnly, offlineMode],
    (): void => {
      rtcDialVersion++;
      resolveRtcRedial(false);
    },
    { flush: 'sync' },
  );

  onBeforeUnmount((): void => {
    stopped = true;
    resolveRtcRedial(false);
    unsubscribeRecoveryStatus?.();
    clearRtcCallDismissTimer();
    unsubscribeRtcCallClosed?.();
    unsubscribeRtcCallClosed = undefined;
    unsubscribeHistoryRtcCall?.();
    unsubscribeHistoryRtcCall = undefined;
    unsubscribeFriendProfileCall?.();
    unsubscribeFriendProfileCall = undefined;
    cancelRtcInviteDialog();
    rtcCall.value = null;
  });

  return {
    rtcRedialDialogOpen,
    resolveRtcRedial,
    rtcRecovery,
    rtcRecoveryBusy,
    rtcRecoveryError,
    recoverRtcCall,
    refreshRtcRecovery,
    dismissRtcRecoveryError,
    canStartRtcCall,
    rtcInviteDialogOpen,
    rtcInviteMembers,
    rtcInviteLoading,
    rtcInviteBusy,
    rtcInviteError,
    cancelRtcInviteDialog,
    confirmRtcInvite,
    startRtcCall,
    handleRtcWindowSse,
  };
};
