import {z} from "zod"

const appearanceSchema = z
    .object({
        name: z.string().nullish(),
        avatar_url: z.string().nullish(),
        greeting: z.string().nullish(),
        starters: z.array(z.string()).nullish(),
        theme: z.enum(["light", "dark", "system"]).nullish(),
        accent: z.string().nullish(),
    })
    .catch({})

const embedConfigSchema = z.object({
    name: z.string().nullish(),
    allowed_origins: z.array(z.string()),
    appearance: appearanceSchema.nullish(),
})

export interface EmbedAppearance {
    name: string
    avatarUrl: string | null
    greeting: string | null
    starters: string[]
    theme: "light" | "dark" | "system"
    accent: string | null
}

export interface EmbedConfig {
    allowedOrigins: string[]
    appearance: EmbedAppearance
}

// `scheme://host[:port]` only: these values go into a response header.
const ORIGIN_PATTERN = /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/
const ACCENT_PATTERN = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/

const httpUrl = (value: string | null | undefined): string | null => {
    if (!value) return null
    try {
        const url = new URL(value)
        return url.protocol === "https:" || url.protocol === "http:" ? url.href : null
    } catch {
        return null
    }
}

/** The config route's answer, reduced to values that are safe to render and to put in a header. */
export const parseEmbedConfig = (raw: unknown): EmbedConfig | null => {
    const parsed = embedConfigSchema.safeParse(raw)
    if (!parsed.success) return null
    const {name, allowed_origins, appearance} = parsed.data
    const accent = appearance?.accent?.trim() ?? ""
    return {
        allowedOrigins: allowed_origins.filter((origin) => ORIGIN_PATTERN.test(origin)),
        appearance: {
            name: appearance?.name?.trim() || name?.trim() || "Assistant",
            avatarUrl: httpUrl(appearance?.avatar_url),
            greeting: appearance?.greeting?.trim() || null,
            starters: (appearance?.starters ?? [])
                .map((starter) => starter.trim())
                .filter(Boolean)
                .slice(0, 4),
            theme: appearance?.theme ?? "system",
            accent: ACCENT_PATTERN.test(accent) ? accent : null,
        },
    }
}

/** Allowed origins plus the Agenta web origin (owner preview); a missing embed's notice frames anywhere. */
export const frameAncestorsPolicy = (
    config: EmbedConfig | null,
    webUrl: string | undefined,
): string => {
    // The "not available" notice holds no chat, so the host page can show it after an archive.
    if (!config) return "frame-ancestors *"
    let webOrigin: string | null = null
    try {
        webOrigin = webUrl ? new URL(webUrl).origin : null
    } catch {
        webOrigin = null
    }
    const origins = [...new Set([...config.allowedOrigins, ...(webOrigin ? [webOrigin] : [])])]
    return origins.length ? `frame-ancestors ${origins.join(" ")}` : "frame-ancestors 'none'"
}

/** Server only: the public config of an embed, or null when it is missing or archived. */
export const fetchEmbedConfig = async (
    embedId: string,
    apiUrl: string | undefined,
): Promise<EmbedConfig | null> => {
    if (!apiUrl || !/^[A-Za-z0-9_-]{1,64}$/.test(embedId)) return null
    try {
        const response = await fetch(
            `${apiUrl.replace(/\/$/, "")}/channels/embed/${embedId}/config`,
            {
                cache: "no-store",
                signal: AbortSignal.timeout(5_000),
            },
        )
        return response.ok ? parseEmbedConfig(await response.json()) : null
    } catch {
        return null
    }
}
