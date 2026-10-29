const TEST_LAYERS = ["unit", "integration", "acceptance"] as const

type TestLayer = (typeof TEST_LAYERS)[number]

function getLicense(): string {
    return process.env.AGENTA_LICENSE || "oss"
}

export function getTestLayer(): TestLayer {
    const layer = process.env.AGENTA_TEST_LAYER
    if (layer && (TEST_LAYERS as readonly string[]).includes(layer)) {
        return layer as TestLayer
    }
    // Default to acceptance to preserve historical behavior.
    return "acceptance"
}

export function getTestDir(): string {
    return `../${getLicense()}/tests/playwright/${getTestLayer()}`
}

function getBaseURL(): string {
    return process.env.AGENTA_WEB_URL || "http://localhost:3000"
}

export function getResultsDir(): string {
    return `results/${getLicense()}`
}

export function getReportsDir(): string {
    return `reports/${getLicense()}`
}

export function getRuntimeRoot(): string {
    return getResultsDir()
}

export function getStorageStatePath(): string {
    return `${getRuntimeRoot()}/state.json`
}

export function getProjectMetadataPath(): string {
    return `${getRuntimeRoot()}/test-project.json`
}

export function getOutputDir(): string {
    return getResultsDir()
}

export function getReportDir(): string {
    return getReportsDir()
}

export function getJunitPath(): string {
    return `${getResultsDir()}/junit.xml`
}

export function getChromiumLaunchOptions(): {args?: string[]} {
    const args: string[] = []

    // A flow that hands the browser a URL naming a container host — the MCP mock's OAuth
    // issuer publishes itself as the address the API dials — needs that name to resolve on
    // this side too. Set e.g. `MAP mock-mcp-gateway 127.0.0.1`.
    // It belongs here rather than in the config's `use.launchOptions`, because globalSetup
    // launches its own browser from this same function; splitting them would authenticate
    // against a different host than the tests then drive.
    const hostResolverRules = process.env.PLAYWRIGHT_HOST_RESOLVER_RULES
    if (hostResolverRules) {
        args.push(`--host-resolver-rules=${hostResolverRules}`)
    }

    try {
        const port = new URL(getBaseURL()).port
        if (port) {
            args.push(`--explicitly-allowed-ports=${port}`)
        }
    } catch {
        // A malformed base URL is the config's problem, not this function's; whatever args
        // are already here still apply.
    }

    return args.length ? {args} : {}
}
