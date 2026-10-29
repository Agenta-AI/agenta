import {readFileSync} from "node:fs"
import {join} from "node:path"

import type {AgentaApi} from "@agentaai/api-client"

import {
    agentStarterTemplateFromEntry,
    type AgentStarterTemplate,
} from "../../src/workflow/agentTemplates"

/** The API's catalog query response, kept equal to the Python reader's output by an API test. */
export const CATALOG_QUERY_RESPONSE = JSON.parse(
    readFileSync(join(__dirname, "../fixtures/agentTemplatesQuery.json"), "utf8"),
) as AgentaApi.TemplatesResponse

/** The frozen handwritten gallery from before the catalog migration (test-only). */
export const FROZEN_GALLERY = JSON.parse(
    readFileSync(
        join(
            __dirname,
            "../../../../../api/oss/tests/pytest/unit/agent_templates/fixtures/gallery_parity.json",
        ),
        "utf8",
    ),
) as AgentStarterTemplate[]

export const FIXTURE_TEMPLATES: AgentStarterTemplate[] = CATALOG_QUERY_RESPONSE.templates.map(
    agentStarterTemplateFromEntry,
)
