import type {Reporter, TestCase, TestResult} from "@playwright/test/reporter"

class LiveReporter implements Reporter {
    onTestBegin(test: TestCase): void {
        console.log(`[test] START:    ${test.titlePath().slice(1).join(" > ")}`)
    }

    onTestEnd(test: TestCase, result: TestResult): void {
        const label = result.status === "passed" ? "SUCCESS: " : "FAILURE: "
        const ms = result.duration
        console.log(`[test] ${label} ${test.titlePath().slice(1).join(" > ")} (${ms}ms)`)
    }
}

export default LiveReporter
