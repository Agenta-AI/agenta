/**
 * Channels state tree — atoms/hooks/selectors over the configuration API
 * (`/channels/*`). Mirrors `state/workflow/`'s layout: fetch atoms in
 * `atoms/`, mutation hooks in `hooks/`, raw HTTP calls in `api.ts`.
 *
 * This layer depends on the API only through the HTTP contract, via the generated Fern
 * `channels` resource client (`getChannelsClient()`), never a hand-written
 * request/response type.
 */
export * from "./api"
export * from "./atoms/fetcher"
export * from "./hooks/useChannelAgentActions"
export * from "./hooks/useChannelGrantActions"
export * from "./hooks/useChannelPolicyResolve"
export * from "./hooks/useChannelSpaceActions"
export * from "./hooks/useChannelThreadActions"
