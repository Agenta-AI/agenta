import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {expect} from "@agenta/web-tests/utils"
import {
    createTagString,
    TestCoverage,
    TestPath,
    TestScope,
} from "@agenta/web-tests/playwright/config/testTags"
import {_AgentaRootsResponse} from "@/oss/services/observability/types"

const observabilityTests = () => {
    test(
        "view traces",
        {
            tag: [
                createTagString("scope", TestScope.OBSERVABILITY),
                createTagString("coverage", TestCoverage.SMOKE),
                createTagString("coverage", TestCoverage.LIGHT),
                createTagString("coverage", TestCoverage.FULL),
                createTagString("path", TestPath.HAPPY),
            ],
        },
        async ({page, apiHelpers, uiHelpers}) => {
            // 1. Navigate to observability page
            await page.goto(`/observability`)
            await uiHelpers.expectPath(`/observability`)

            // 2. Fetch traces
            const tracesResponse = await apiHelpers.waitForApiResponse<_AgentaRootsResponse>({
                route: `/api/observability/v1/traces`,
                method: "GET",
            })
            const allTraces = await tracesResponse
            const traces = allTraces.trees

            expect(Array.isArray(traces)).toBe(true)
            expect(traces.length).toBeGreaterThan(0)

            // 4. wait for ui to finish the loading
            const spinner = page.locator(".ant-spin").first()
            if (await spinner.count()) {
                await spinner.waitFor({state: "hidden"})
            }

            // 3. Randomly select a trace
            const randomTraceIndex = Math.floor(Math.random() * traces.length)
            const nodeName = traces[randomTraceIndex].nodes[0].node.name

            // 4. Find the trace in the table
            const traceTable = page.getByRole("table")
            await traceTable.scrollIntoViewIfNeeded()

            const traceTableRow = traceTable.getByRole("row").nth(randomTraceIndex + 1)
            await expect(traceTableRow).toBeVisible()

            // 5. Click on trace to open drawer
            const targetCell = traceTableRow.getByRole("cell").nth(2)
            await expect(targetCell).toBeVisible()
            await targetCell.click()

            // 6. Assert drawer is open
            await expect(page.locator(".ant-drawer-content-wrapper")).toBeVisible()
            const loading = page.getByText("Loading...").first()
            const loadingExists = (await loading.count()) > 0
            if (loadingExists) {
                await expect(loading).toBeVisible()
                await expect(loading).not.toBeVisible()
            }

            await expect(page.getByText("Trace", {exact: true}).first()).toBeVisible()
            await expect(page.getByText(nodeName).first()).toBeVisible()
        },
    )
}

export default observabilityTests
