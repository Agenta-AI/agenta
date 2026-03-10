function getLicense(): string {
    return process.env.AGENTA_LICENSE || "oss"
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
