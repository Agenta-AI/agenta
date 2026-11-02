import {atom} from "jotai"

/**
 * Injectable function that returns auth headers for execution HTTP requests.
 *
 * OSS sets this once in AppGlobalWrappers with a function that calls `getJWT()` and returns
 * `{Authorization: `Bearer ${jwt}`}`.
 *
 * A LEAF module on purpose: the request builder (`agentRequest`) needs only this atom, and it
 * used to reach for it inside `webWorkerIntegration`, whose imports are the entire execution
 * runner — so every consumer of the lean `@agenta/playground/agent-chat` entry pulled that graph
 * in behind it. Keep this file dependency-free.
 *
 * @example
 * ```ts
 * import { getJWT } from "@/oss/services/api"
 * store.set(executionHeadersAtom, async () => {
 *     const jwt = await getJWT()
 *     return jwt ? { Authorization: `Bearer ${jwt}` } : {}
 * })
 * ```
 */
export const executionHeadersAtom = atom<(() => Promise<Record<string, string>>) | null>(null)
