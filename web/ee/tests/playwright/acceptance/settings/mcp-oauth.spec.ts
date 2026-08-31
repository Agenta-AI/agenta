import {TestLicenseType} from "@agenta/web-tests/playwright/config/testTags"
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {mcpOAuthAcceptanceTests} from "@agenta/oss/tests/playwright/acceptance/settings/mcp-oauth"

test.describe("Settings: MCP OAuth", mcpOAuthAcceptanceTests(TestLicenseType.EE))
