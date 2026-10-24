/**
 * `@agenta/entities/sharing` — agent privacy, session sharing and the member picker.
 *
 * Wire schemas, project-scoped query keys, the API calls (through the Fern `sharing` client)
 * and the query and mutation atoms.
 */
export {
    visibilitySchema,
    sessionRoleSchema,
    effectiveRoleSchema,
    accessPolicySchema,
    sessionGrantSchema,
    disclosedConnectionSchema,
    shareDisclosureSchema,
    notShareableReasonSchema,
    agentSharingStateSchema,
    sessionSharingStateSchema,
    agentSharingResponseSchema,
    sessionSharingResponseSchema,
    projectMemberProfileSchema,
    sharingMembersWindowingSchema,
    sharingMembersResponseSchema,
    type Visibility,
    type SessionRole,
    type EffectiveRole,
    type AccessPolicy,
    type SessionGrant,
    type DisclosedConnection,
    type ShareDisclosure,
    type NotShareableReason,
    type AgentSharingState,
    type SessionSharingState,
    type AgentSharingResponse,
    type SessionSharingResponse,
    type ProjectMemberProfile,
    type SharingMembersResponse,
} from "./core/schema"

export {sharingKeys} from "./core/keys"

export {
    fetchAgentSharing,
    setAgentVisibility,
    transferAgent,
    takeAgentOwnership,
    fetchSessionSharing,
    upsertSessionGrant,
    revokeSessionGrant,
    setSessionVisibility,
    restrictSessionToOwner,
    querySharingMembers,
    fetchSharingMemberRoster,
    MEMBER_ROSTER_PAGE_SIZE,
    MEMBER_ROSTER_MAX_PAGES,
    type AgentSharingParams,
    type SessionSharingParams,
    type SetAgentVisibilityParams,
    type TransferAgentParams,
    type UpsertSessionGrantParams,
    type RevokeSessionGrantParams,
    type SetSessionVisibilityParams,
    type QuerySharingMembersParams,
} from "./api"

export {
    agentSharingQueryAtomFamily,
    sessionSharingQueryAtomFamily,
    sharingMembersQueryAtomFamily,
    sharingMemberRosterQueryAtom,
    SESSION_SHARING_RECHECK_MS,
    recheckSessionSharing,
    setAgentVisibilityAtom,
    transferAgentAtom,
    takeAgentOwnershipAtom,
    upsertSessionGrantAtom,
    revokeSessionGrantAtom,
    setSessionVisibilityAtom,
    restrictSessionToOwnerAtom,
} from "./state/store"
