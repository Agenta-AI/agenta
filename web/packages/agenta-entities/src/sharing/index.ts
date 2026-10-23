/**
 * `@agenta/entities/sharing` — agent privacy, session sharing and the member picker.
 *
 * Wire schemas and project-scoped query keys.
 */
export {
    visibilitySchema,
    sessionRoleSchema,
    effectiveRoleSchema,
    accessPolicySchema,
    sessionGrantSchema,
    disclosedConnectionSchema,
    shareDisclosureSchema,
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
    type AgentSharingState,
    type SessionSharingState,
    type AgentSharingResponse,
    type SessionSharingResponse,
    type ProjectMemberProfile,
    type SharingMembersResponse,
} from "./core/schema"

export {sharingKeys} from "./core/keys"
