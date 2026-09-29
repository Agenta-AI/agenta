/** What a host or a story injects into the HTML app viewer. Its own module so the viewer's parts
 * (the body, the Share button) read it without importing each other. */
import {createContext} from "react"

import {
    type GrantLevel,
    type GrantRecord,
    type HtmlAppHost,
    type HtmlAppHostOptions,
} from "@agenta/entities/drive"

import {type AssembleIo} from "./assemble"

export interface GrantStore {
    get: (mountId: string, dir: string) => GrantRecord | null
    set: (mountId: string, dir: string, level: GrantLevel, asked?: GrantLevel) => void
}

const grantKey = (mountId: string, dir: string) => `${mountId}::${dir}`

/** An isolated in-memory store (stories, tests). */
export const createGrantStore = (): GrantStore => {
    const grants = new Map<string, GrantRecord>()
    return {
        get: (mountId, dir) => grants.get(grantKey(mountId, dir)) ?? null,
        set: (mountId, dir, level, asked = level) => {
            grants.set(grantKey(mountId, dir), {level, asked})
        },
    }
}

export interface HtmlAppEnv {
    /** Override the flag (stories); default reads {@link agentAppsEnabledAtom}. */
    enabled?: boolean
    /** Bridge host factory; default `createHtmlAppHost` (stories inject the mock). */
    createHost?: (opts: HtmlAppHostOptions) => HtmlAppHost
    /** Mount io override (stories serve the mock's files); default: the real mount. */
    io?: AssembleIo | null
    /** Whether "Read and write files" is offered; default: the drive's upload gate. */
    canEditMounts?: boolean
    /** Full URL of a share link's page. The host owns its routes; without it, Share is hidden. */
    sharePageUrl?: (token: string) => string
    /** Kit stylesheet; default `KIT_CSS`. */
    kitCss?: string
    /** Bridge stub source; default `BRIDGE_STUB`. */
    bridgeStub?: string
    resolveTokens?: () => Record<string, string>
    grants?: GrantStore
}

export const HtmlAppEnvContext = createContext<HtmlAppEnv>({})
