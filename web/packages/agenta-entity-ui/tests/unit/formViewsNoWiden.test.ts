import {describe, expect, it} from "vitest"

import {integrationConnectView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/integrationConnectView"
import {mcpConnectView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/mcpConnectView"
import {skillNewView} from "../../src/DrillInView/SchemaControls/agentTemplate/views/skillNewView"
import {secretAttachView} from "../../src/secret/views/secretAttachView"

/** The canvas draws these form steps with only a close button in the header (F02 f5). */
describe("form views with no widen button", () => {
    it.each([
        ["Connect", integrationConnectView],
        ["Connect server", mcpConnectView],
        ["Attach a secret", secretAttachView],
        ["New skill", skillNewView],
    ])("%s sets widenButton to false", (_, view) => {
        expect(view.widenButton).toBe(false)
    })
})
