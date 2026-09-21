import {TestLicenseType} from "@agenta/web-tests/playwright/config/testTags"
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {mcpAgentConfigAcceptanceTests} from "./mcp-agent-config"

test.describe(
    "Playground: MCP in the agent configuration",
    mcpAgentConfigAcceptanceTests(TestLicenseType.OSS),
)
