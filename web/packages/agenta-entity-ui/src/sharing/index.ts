/**
 * `@agenta/entity-ui/sharing` — agent privacy and owner UI, plus the member picker and the share
 * disclosure. Those two are built in `@agenta/sessions-ui` (the chat Share dialog uses them, and
 * this package already depends on that one) and re-exported here.
 */
export {AgentPrivacyControl, type AgentPrivacyControlProps} from "./AgentPrivacyControl"
export {
    AgentPrivacyDialog,
    type AgentPrivacyDialogProps,
    type AgentPrivacyProps,
    type AgentSharingWrites,
} from "./AgentPrivacyDialog"
export {AgentTransferDialog, type AgentTransferDialogProps} from "./AgentTransferDialog"
export {useAgentSharingWrites, type AgentSharingNotice} from "./useAgentSharingWrites"
export {agentSharingCopy, joinNames, memberPickerCopy, shareDisclosureCopy} from "./copy"
export {
    MemberPicker,
    ShareDisclosureNotice,
    sharingWriteResultFromError,
    disclosureAccountNames,
    type MemberPickerProps,
    type ShareDisclosureNoticeProps,
    type ShareDisclosureTarget,
    type SharingPerson,
    type SharingWriteResult,
} from "@agenta/sessions-ui/sharing"
