import {describe, expect, it} from "vitest"

import {buildRegistrySections, toSkillListItem, toSourceInfo} from "../../src/registrySections"

const skill = (over: Record<string, unknown> = {}) => ({
    workflow_id: `wf-${Math.random().toString(36).slice(2, 8)}`,
    workflow_slug: "a-skill-ab12",
    name: "a-skill",
    skill_name: "a-skill",
    description: "does a thing",
    version: "v2",
    files_count: 3,
    used_by_count: 1,
    ...over,
})

const source = (over: Record<string, unknown> = {}) => ({
    id: "src-1",
    slug: "obra-superpowers",
    repo_url: "https://github.com/obra/superpowers",
    last_seen_commit_sha: "b36e082",
    sync_enabled: false,
    ...over,
})

describe("toSkillListItem", () => {
    it("prefers the skill name as the registry identity", () => {
        const item = toSkillListItem(
            skill({name: "artifact-name", skill_name: "skill-name"}),
            "project",
        )
        // The storage slug (name-ab12) is plumbing; the registry shows the skill's own name.
        expect(item.slug).toBe("skill-name")
        expect(item.origin).toBe("project")
    })

    it("strips the v prefix so the tag does not render vv2", () => {
        expect(toSkillListItem(skill({version: "v2"}), "project").version).toBe("2")
    })
})

describe("toSourceInfo", () => {
    it("labels a source by owner/repo from its URL", () => {
        const info = toSourceInfo(source())
        expect(info.label).toBe("obra/superpowers")
        expect(info.commitSha).toBe("b36e082")
    })

    it("falls back to the slug when the URL is not parseable", () => {
        expect(toSourceInfo(source({repo_url: "not-a-github-url"})).label).toBe("obra-superpowers")
    })
})

describe("buildRegistrySections", () => {
    it("groups imported skills by source and leaves the rest in This project", () => {
        const {sections} = buildRegistrySections(
            [
                skill({name: "brainstorming", source_id: "src-1"}),
                skill({name: "executing-plans", source_id: "src-1"}),
                skill({name: "locally-made"}),
            ],
            [skill({name: "agenta-getting-started"})],
            [source()],
        )

        const byKey = Object.fromEntries(sections.map((s) => [s.key, s]))
        expect(byKey["source:src-1"].skills.map((s) => s.name)).toEqual([
            "brainstorming",
            "executing-plans",
        ])
        expect(byKey.project.skills.map((s) => s.name)).toEqual(["locally-made"])
        expect(byKey.agenta.skills.map((s) => s.name)).toEqual(["agenta-getting-started"])
    })

    it("moves a detached import back to This project but keeps its provenance", () => {
        const {sections} = buildRegistrySections(
            [skill({name: "brainstorming", source_id: "src-1", source_detached: true})],
            [],
            [source()],
        )

        const project = sections.find((s) => s.key === "project")!
        expect(project.skills.map((s) => s.name)).toEqual(["brainstorming"])
        // Grouping treats it as ours again; the drawer still says where it came from.
        expect(project.skills[0].source?.label).toBe("obra/superpowers")
        expect(project.skills[0].source?.detached).toBe(true)
        expect(sections.some((s) => s.key.startsWith("source:"))).toBe(false)
    })

    it("keeps a skill whose source row is gone, under This project", () => {
        const {sections} = buildRegistrySections(
            [skill({name: "orphaned", source_id: "src-missing"})],
            [],
            [],
        )
        const project = sections.find((s) => s.key === "project")!
        expect(project.skills.map((s) => s.name)).toEqual(["orphaned"])
    })

    it("counts every section in the rail and filters to the selected one", () => {
        const skills = [skill({source_id: "src-1"}), skill({name: "local"})]
        const {sources} = buildRegistrySections(skills, [skill({name: "builtin"})], [source()])
        expect(sources.find((s) => s.key === "all")?.count).toBe(3)

        const {sections} = buildRegistrySections(
            skills,
            [skill({name: "builtin"})],
            [source()],
            "source:src-1",
        )
        expect(sections.map((s) => s.key)).toEqual(["source:src-1"])
    })
})
