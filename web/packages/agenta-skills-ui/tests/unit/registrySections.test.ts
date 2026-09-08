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

const origin = (over: Record<string, unknown> = {}) => ({
    provider: "github",
    repository: "obra/superpowers",
    path: "skills/brainstorming",
    resolved_version: "b36e082",
    imported_at_url: "https://github.com/obra/superpowers/tree/b36e082/skills/brainstorming",
    detached: false,
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
    it("labels an import by its repository and carries the resolved version", () => {
        const info = toSourceInfo(origin())
        expect(info.label).toBe("obra/superpowers")
        expect(info.repoUrl).toBe("https://github.com/obra/superpowers")
        expect(info.commitSha).toBe("b36e082")
    })

    it("falls back to a neutral label without a repository", () => {
        expect(toSourceInfo(origin({repository: null})).label).toBe("Imported")
    })
})

describe("buildRegistrySections", () => {
    it("groups imported skills by repository and leaves the rest in This project", () => {
        const {sections} = buildRegistrySections(
            [
                skill({name: "brainstorming", origin: origin()}),
                skill({
                    name: "executing-plans",
                    origin: origin({path: "skills/executing-plans"}),
                }),
                skill({name: "locally-made"}),
            ],
            [skill({name: "agenta-getting-started"})],
        )

        const byKey = Object.fromEntries(sections.map((s) => [s.key, s]))
        expect(byKey["source:obra/superpowers"].skills.map((s) => s.name)).toEqual([
            "brainstorming",
            "executing-plans",
        ])
        expect(byKey.project.skills.map((s) => s.name)).toEqual(["locally-made"])
        expect(byKey.agenta.skills.map((s) => s.name)).toEqual(["agenta-getting-started"])
    })

    it("moves a detached import back to This project but keeps its provenance", () => {
        const {sections} = buildRegistrySections(
            [skill({name: "brainstorming", origin: origin({detached: true})})],
            [],
        )

        const project = sections.find((s) => s.key === "project")!
        expect(project.skills.map((s) => s.name)).toEqual(["brainstorming"])
        // Grouping treats it as ours again; the drawer still says where it came from.
        expect(project.skills[0].source?.label).toBe("obra/superpowers")
        expect(project.skills[0].source?.detached).toBe(true)
        expect(sections.some((s) => s.key.startsWith("source:"))).toBe(false)
    })

    it("carries the section's skill ids so update checks address them", () => {
        const {sections} = buildRegistrySections(
            [skill({workflow_id: "wf-1", origin: origin()})],
            [],
        )
        const repo = sections.find((s) => s.key === "source:obra/superpowers")!
        expect(repo.skillIds).toEqual(["wf-1"])
        expect(repo.repository).toBe("obra/superpowers")
    })

    it("counts every section in the rail and filters to the selected one", () => {
        const skills = [skill({origin: origin()}), skill({name: "local"})]
        const {sources} = buildRegistrySections(skills, [skill({name: "builtin"})])
        expect(sources.find((s) => s.key === "all")?.count).toBe(3)

        const {sections} = buildRegistrySections(
            skills,
            [skill({name: "builtin"})],
            "source:obra/superpowers",
        )
        expect(sections.map((s) => s.key)).toEqual(["source:obra/superpowers"])
    })
})
