import {createElement} from "react"

import {describe, expect, it} from "vitest"

import type {SidebarEntity, SidebarEntityRef, SidebarEntitySource} from "./types"
import {resolveChildren} from "./useSidebarDynamicChildren"

const ref = (id: string, name: string): SidebarEntityRef => ({id, name})

const entity = (overrides: Partial<SidebarEntity> = {}): SidebarEntity => ({
    parentKey: "project-sessions-link",
    kind: "app",
    activeSourceAtom: null as unknown as SidebarEntity["activeSourceAtom"],
    getLabel: (r) => r.name ?? r.id,
    childLink: (r) => `/apps/${r.id}/playground`,
    icon: createElement("span"),
    maxItems: 14,
    ...overrides,
})

const ready = (refs: SidebarEntityRef[]): SidebarEntitySource => ({status: "ready", refs})

describe("resolveChildren", () => {
    it("carries the entity's tooltip onto each row", () => {
        const children = resolveChildren(
            entity({getTooltip: (r) => (r.id === "s1" ? "Arabic Poetry Scheduler" : undefined)}),
            ready([ref("s1", "Morning poem"), ref("s2", "Untitled session")]),
            "/w/w1/p/p1",
        )

        expect(children.map((child) => child.tooltip)).toEqual([
            "Arabic Poetry Scheduler",
            undefined,
        ])
    })

    // A row whose agent hasn't resolved must not fall back to repeating its own label.
    it("leaves the tooltip unset when the entity declares none", () => {
        const children = resolveChildren(entity(), ready([ref("s1", "Morning poem")]), "/w/w1/p/p1")

        expect(children[0].tooltip).toBeUndefined()
    })

    it("renders up to maxItems rows and adds Show all beyond it", () => {
        const refs = Array.from({length: 20}, (_, index) => ref(`s${index}`, `Session ${index}`))
        const children = resolveChildren(
            entity({showAllLink: (projectURL) => `${projectURL}/sessions`}),
            ready(refs),
            "/w/w1/p/p1",
        )

        expect(children).toHaveLength(15)
        expect(children.at(-1)?.title).toBe("Show all")
    })
})
