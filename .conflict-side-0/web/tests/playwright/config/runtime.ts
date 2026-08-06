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
    try {
        const url = new URL(getBaseURL())
        const port = url.port

        if (!port) {
            return {}
        }

        return {
            args: [`--explicitly-allowed-ports=${port}`],
        }
    } catch {
        return {}
    }
}
