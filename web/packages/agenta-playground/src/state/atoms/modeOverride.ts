/**
 * Playground mode override (chat ⇄ completion behavior).
 *
 * `is_chat` on the workflow entity is a capability: the app accepts a
 * `messages` input. Which behavior the playground uses (multi-turn chat vs
 * single-turn completion over N test cases) is a user choice, scoped to the
 * playground, persisted per app, and never committed or versioned.
 *
 * The override only has an effect for chat-capable apps. Completion apps
 * cannot run conversations, so `isChatModeAtom` ignores the override for
 * them. Request shapes always follow the capability, not the behavior:
 * a chat app running with completion behavior still sends chat-shaped
 * requests (history in, one reply out).
 *
 * Design doc: docs/design/playground-mode-switch/
 */

import {workflowMolecule} from "@agenta/entities/workflow"
import {atom} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {playgroundNodesAtom} from "./playground"

export type PlaygroundMode = "chat" | "completion"

/**
 * Persisted overrides, one entry per app. Keyed by the root workflow id so
 * the choice survives reloads and revision switches. Entries equal to the
 * app's capability default are never stored (see the setter below).
 */
const modeOverridesByAppStorageAtom = atomWithStorage<Record<string, PlaygroundMode>>(
    "agenta:playground:mode",
    {},
)

/**
 * The app's capability-derived mode: what the workflow can do, regardless
 * of any user override. `undefined` while the playground has no root node.
 */
export const playgroundCapabilityModeAtom = atom<PlaygroundMode | undefined>((get) => {
    const rootNode = get(playgroundNodesAtom).find((n) => n.depth === 0)
    if (!rootNode) return undefined
    return get(workflowMolecule.selectors.executionMode(rootNode.entityId))
})

/**
 * Stable per-app key for the override record. The playground's root node
 * holds a revision id; the revision's `workflow_id` is the app. Falls back
 * to the entity id itself for local drafts that have no parent workflow yet.
 */
const playgroundModeScopeKeyAtom = atom<string | null>((get) => {
    const rootNode = get(playgroundNodesAtom).find((n) => n.depth === 0)
    if (!rootNode) return null
    const entity = get(workflowMolecule.selectors.data(rootNode.entityId)) as
        {workflow_id?: string | null} | null | undefined
    return entity?.workflow_id || rootNode.entityId
})

/**
 * The user's mode override for the current app, or `null` to follow the
 * capability default.
 *
 * Writing the capability value (or `null`) removes the stored entry, so the
 * record only ever holds real deviations from the default.
 */
export const playgroundModeOverrideAtom = atom(
    (get) => {
        const key = get(playgroundModeScopeKeyAtom)
        if (!key) return null
        return get(modeOverridesByAppStorageAtom)[key] ?? null
    },
    (get, set, next: PlaygroundMode | null) => {
        const key = get(playgroundModeScopeKeyAtom)
        if (!key) return
        const overrides = get(modeOverridesByAppStorageAtom)
        const capability = get(playgroundCapabilityModeAtom)
        const normalized = next === capability ? null : next
        if (normalized === null) {
            if (!(key in overrides)) return
            const {[key]: _removed, ...rest} = overrides
            set(modeOverridesByAppStorageAtom, rest)
            return
        }
        if (overrides[key] === normalized) return
        set(modeOverridesByAppStorageAtom, {...overrides, [key]: normalized})
    },
)

/**
 * Effective playground behavior: capability combined with the override.
 *
 * `true` for chat behavior, `false` for completion behavior, `undefined`
 * while the playground has no root node. Completion apps always get
 * completion behavior; the override cannot make them chat.
 *
 * Exposed to consumers as `isChatModeAtom` (execution selectors).
 */
export const playgroundIsChatBehaviorAtom = atom<boolean | undefined>((get) => {
    const capability = get(playgroundCapabilityModeAtom)
    if (capability === undefined) return undefined
    if (capability !== "chat") return false
    return get(playgroundModeOverrideAtom) !== "completion"
})
