export {ChannelsPage, type ChannelsPageProps, type ChannelsPanelRenderProps} from "./ChannelsPage"
export {ChannelConnectFlow, type ChannelConnectFlowProps} from "./ChannelConnectFlow"
export {ChannelManagePanel, type ChannelManagePanelProps} from "./ChannelManagePanel"
export {
    EMPTY_CONNECTIONS,
    NOOP_ACTIONS,
    answeringAgentName,
    botHandle,
    defaultSlackIdentity,
    slackInviteHandle,
    connectionScope,
    errorMessage,
    hasAnyIssue,
    platformLabel,
    summarizeConnection,
    type ChannelRowSummary,
} from "./helpers"
export {
    buildAgentChannelsActions,
    channelKey,
    chatTypeOf,
    clientErrorMessage,
    groupKindsOf,
    mapConnectionRow,
    mapSpaceRow,
    type AgentChannelsActionsOptions,
    type ChannelsClientLike,
} from "./actions"
export {QrCode, encodeQr} from "./qr"
export type {
    ChannelPlatform,
    ChannelInstallMode,
    ChannelStatus,
    ChannelChatType,
    ChannelBehavior,
    ChannelBehaviorState,
    ChannelChat,
    ChannelSpace,
    ChannelSpaceCandidate,
    ChannelSpaceKind,
    ChannelSpaceMembership,
    ChannelConnection,
    ChannelConnections,
    ChannelAnsweringAgent,
    ChannelScope,
    ChannelSetupField,
    ChannelSetupIdentity,
    ChannelSetupInfo,
    ChannelsActions,
    HostedTelegramLink,
} from "./types"
