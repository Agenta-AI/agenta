import {TestLicenseType} from "@agenta/web-tests/playwright/config/testTags"
import {test} from "@agenta/web-tests/tests/fixtures/base.fixture"

import {mcpConnectAcceptanceTests} from "./mcp-connect"

test.describe("Settings: MCP connect", mcpConnectAcceptanceTests(TestLicenseType.OSS))
