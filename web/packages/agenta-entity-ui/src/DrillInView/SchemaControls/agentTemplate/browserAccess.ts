/** Which of the user's browser logins an agent may use (`parameters.agent.browser`). */
export type BrowserAccess = {mode: "all"} | {mode: "off"} | {mode: "selected"; profiles: string[]}

export type BrowserAccessMode = BrowserAccess["mode"]

/** Absent or unknown means "all". */
export function readBrowserAccess(value: unknown): BrowserAccess {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {mode: "all"}
    const browser = value as Record<string, unknown>
    if (browser.mode === "off") return {mode: "off"}
    if (browser.mode === "selected") {
        const profiles = Array.isArray(browser.profiles)
            ? browser.profiles.filter((id): id is string => typeof id === "string")
            : []
        return {mode: "selected", profiles}
    }
    return {mode: "all"}
}

export function writeBrowserAccess(
    config: Record<string, unknown>,
    access: BrowserAccess,
): Record<string, unknown> {
    const {browser: _browser, ...rest} = config
    return access.mode === "all" ? rest : {...rest, browser: access}
}
