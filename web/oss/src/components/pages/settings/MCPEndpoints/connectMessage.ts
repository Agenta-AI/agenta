// Pure helpers factored out of MCPConnectDialog so the postMessage trust check is
// unit-testable without rendering React (mirrors ConnectDrawer.tsx's own check).

export const MCP_OAUTH_CONNECTED = "mcp:oauth:connected"

export function buildTrustedOrigins(urls: (string | undefined)[]): Set<string> {
    const origins = new Set<string>()
    for (const url of urls) {
        if (!url) continue
        try {
            origins.add(new URL(url).origin)
        } catch {
            // ignore invalid env URLs
        }
    }
    return origins
}

export function isTrustedOauthConnectedMessage(
    data: unknown,
    origin: string,
    trustedOrigins: Set<string>,
): boolean {
    if (!trustedOrigins.has(origin)) return false
    return (
        typeof data === "object" &&
        data !== null &&
        (data as {type?: unknown}).type === MCP_OAUTH_CONNECTED
    )
}
