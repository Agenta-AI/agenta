/**
 * The template catalogue and the playbooks are two hand-kept halves of one thing: this file
 * describes each template to the user, `sdks/python/.../agent_templates/*.py` describes it to the
 * builder agent. Nothing generates one from the other, and nothing until now noticed them drifting
 * — the connection slots were migrated FROM that prose, so a change on either side should fail
 * here rather than quietly leave the page describing an agent nobody builds.
 */

import {readFileSync, readdirSync} from "node:fs"
import {join} from "node:path"

import {describe, expect, it} from "vitest"

import {AGENT_TEMPLATES, PROVIDERS, templateConnections} from "../../src/workflow/agentTemplates"

const PLAYBOOK_DIR = join(
    __dirname,
    "../../../../../sdks/python/agenta/sdk/agents/adapters/agent_templates",
)

/** key -> the playbook's "## Connections" paragraph, lowercased. */
const playbookConnections = (): Map<string, string> => {
    const out = new Map<string, string>()
    for (const file of readdirSync(PLAYBOOK_DIR)) {
        if (!file.endsWith(".py") || file === "__init__.py") continue
        const source = readFileSync(join(PLAYBOOK_DIR, file), "utf8")
        const keys = [...source.matchAll(/key="([^"]+)"/g)].map((m) => m[1])
        const sections = [...source.matchAll(/## Connections\n([\s\S]*?)(?=\n##|\n"""|$)/g)].map(
            (m) => m[1].replace(/\s+/g, " ").toLowerCase(),
        )
        keys.forEach((key, index) => {
            if (sections[index]) out.set(key, sections[index])
        })
    }
    return out
}

describe("catalogue ↔ playbook parity", () => {
    const playbooks = playbookConnections()

    it("describes exactly the templates the playbooks define", () => {
        expect(new Set(AGENT_TEMPLATES.map((t) => t.key))).toEqual(new Set(playbooks.keys()))
    })

    /**
     * Predates the slots and is not resolved here: both templates list Slack as required while
     * their playbook's Connections section names only Sentry. Dropping a required connection is a
     * product decision, so the divergence is recorded rather than asserted away or quietly fixed.
     */
    const KNOWN_DIVERGENCES = new Set(["uptime-reporter: slack", "oncall-briefer: slack"])

    it("names only providers its playbook's Connections section mentions", () => {
        const missing: string[] = []
        for (const template of AGENT_TEMPLATES) {
            const prose = playbooks.get(template.key)
            if (!prose) continue
            for (const slot of templateConnections(template)) {
                for (const slug of [slot.primary.slug, ...(slot.alternatives ?? [])]) {
                    // Match on the display name ("Google Drive"), falling back to the slug: the
                    // prose is written for a reader, not keyed by integration id.
                    const label = (PROVIDERS[slug]?.label ?? slug).toLowerCase()
                    const entry = `${template.key}: ${slug}`
                    if (
                        !prose.includes(label) &&
                        !prose.includes(slug) &&
                        !KNOWN_DIVERGENCES.has(entry)
                    ) {
                        missing.push(entry)
                    }
                }
            }
        }
        expect(missing).toEqual([])
    })
})
