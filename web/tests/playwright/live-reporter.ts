import type {FullResult, Reporter, TestCase, TestResult} from "@playwright/test/reporter"

const STATUS_LABEL: Record<string, string> = {
    passed: "PASSED:  ",
    failed: "FAILED:  ",
    timedOut: "TIMEOUT: ",
    skipped: "SKIPPED: ",
    interrupted: "INTERRUPTED: ",
}

const stripAnsi = (str: string) => str.replace(/\x1b\[[0-9;]*m/g, "")

function printError(
    error: {
        message?: string
        stack?: string
        location?: {file: string; line: number; column: number}
    },
    indent = "         ",
) {
    if (error.location) {
        console.log(`${indent}@ ${error.location.file}:${error.location.line}`)
    }
    const message = error.message ? stripAnsi(error.message).trim() : ""
    if (message) {
        for (const line of message.split("\n")) {
            console.log(`${indent}${line}`)
        }
    }
    const stack = error.stack ? stripAnsi(error.stack).trim() : ""
    if (stack) {
        const frames = stack
            .split("\n")
            .filter((l) => l.trim().startsWith("at "))
            .slice(0, 10)
        for (const frame of frames) {
            console.log(`${indent}${frame}`)
        }
    }
}

interface FailureRecord {
    title: string
    errors: TestResult["errors"]
    stdout: string
    stderr: string
}

class LiveReporter implements Reporter {
    private counts = {passed: 0, failed: 0, skipped: 0}
    private failures: FailureRecord[] = []
    // Tracks the last failed result per test for accurate failure reporting in onEnd
    private testResults: Map<string, {test: TestCase; lastFailedResult?: TestResult}> = new Map()

    onTestBegin(test: TestCase): void {
        console.log(`[test] START:   ${test.titlePath().slice(1).join(" > ")}`)
    }

    onTestEnd(test: TestCase, result: TestResult): void {
        // Live per-attempt logging only — no counting here to avoid double-counting retries
        const label = STATUS_LABEL[result.status] ?? "UNKNOWN: "
        const title = test.titlePath().slice(1).join(" > ")
        console.log(`[test] ${label} ${title} (${result.duration}ms)`)

        if (result.status !== "passed" && result.status !== "skipped") {
            for (const error of result.errors) {
                printError(error)
            }
        }

        const entry = this.testResults.get(test.id) ?? {test}
        if (result.status !== "passed" && result.status !== "skipped") {
            entry.lastFailedResult = result
        }
        this.testResults.set(test.id, entry)
    }

    onEnd(_result: FullResult): void {
        // Aggregate using test.outcome() so retried-then-passed tests count as passed
        for (const {test, lastFailedResult} of this.testResults.values()) {
            const title = test.titlePath().slice(1).join(" > ")
            const outcome = test.outcome()

            if (outcome === "skipped") {
                this.counts.skipped++
            } else if (outcome === "expected" || outcome === "flaky") {
                this.counts.passed++
            } else if (outcome === "unexpected" && lastFailedResult) {
                this.counts.failed++
                const stdout = lastFailedResult.stdout
                    .map((c) => (typeof c === "string" ? c : c.toString()))
                    .join("")
                const stderr = lastFailedResult.stderr
                    .map((c) => (typeof c === "string" ? c : c.toString()))
                    .join("")
                this.failures.push({title, errors: lastFailedResult.errors, stdout, stderr})
            }
        }

        const {passed, failed, skipped} = this.counts

        if (this.failures.length > 0) {
            console.log(`\n${"─".repeat(60)}`)
            console.log(`[test] FAILURES (${this.failures.length})`)
            console.log("─".repeat(60))
            for (const {title, errors, stdout, stderr} of this.failures) {
                console.log(`\n  ✗ ${title}`)
                for (const error of errors) {
                    printError(error, "    ")
                }
                if (stdout.trim()) {
                    console.log("    --- stdout ---")
                    for (const line of stripAnsi(stdout).trim().split("\n")) {
                        console.log(`    ${line}`)
                    }
                }
                if (stderr.trim()) {
                    console.log("    --- stderr ---")
                    for (const line of stripAnsi(stderr).trim().split("\n")) {
                        console.log(`    ${line}`)
                    }
                }
            }
            console.log("─".repeat(60))
        }

        console.log(`\n[test] ${passed} passed, ${failed} failed, ${skipped} skipped`)
    }
}

export default LiveReporter
