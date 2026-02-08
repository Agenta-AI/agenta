import {atom} from "jotai"
import {selectAtom} from "jotai/utils"

import {detectChatVariantFromOpenAISchema} from "@/oss/lib/shared/variant/genericTransformer"
import {appUriInfoAtom, getSpecLazy} from "@/oss/state/variant/atoms/fetcher"

import {revisionListAtom} from "./variants"

/**
 * App-level chat mode detection (pure selector)
 * Derived from the first revision. Immutable for the session by design.
 */
export const appChatModeAtom = selectAtom(
    atom((get) => ({revisions: get(revisionListAtom), appUri: get(appUriInfoAtom)})),
    ({revisions, appUri}) => {
        const first = (revisions || [])[0]
        if (!first) return undefined
        const spec = getSpecLazy()
        if (spec) {
            const result = detectChatVariantFromOpenAISchema(spec, {
                routePath: appUri?.routePath,
                runtimePrefix: appUri?.runtimePrefix || "",
            })
            return result
        } else {
            return undefined
        }
        return false
    },
    (a, b) => a === b,
)

/**
 * App-level type derived from chat mode.
 * Expand this if we later support a distinct "custom" app type.
 */
export type AppType = "chat" | "completion"

export const appTypeAtom = selectAtom(
    appChatModeAtom,
    (isChat): AppType => (isChat === undefined ? undefined : isChat ? "chat" : "completion"),
    (a, b) => a === b,
)
