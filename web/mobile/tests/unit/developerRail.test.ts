import type {SidebarConfig} from "@agenta/navigation"
import {describe, expect, it} from "vitest"

import {DEVELOPER_VIEWS} from "@/features/developer/developerViews"
import {developerNavSlots} from "@/features/nav/developerNavSlots"

const P = "/w/ws-1/p/proj-1"

/** What a reader sees of a rail row: its key, label, link and children. */
interface Row {
    key: string
    title: string
    link?: string
    submenu?: Row[]
}
const shape = (items: SidebarConfig[]): Row[] =>
    items.map(({key, title, link, submenu}) => ({
        key,
        title,
        ...(link ? {link} : {}),
        ...(submenu ? {submenu: shape(submenu)} : {}),
    }))

describe("the developer rows of the main rail", () => {
    it("beta developer mode lays them out like the old app: Prompts, Evaluation, Observability", () => {
        const slots = developerNavSlots(P, DEVELOPER_VIEWS, true)
        expect(shape(slots.afterHome)).toEqual([
            {key: "developer-view-prompts", title: "Prompts", link: `${P}/prompts`},
        ])
        expect(shape(slots.afterSessions)).toEqual([
            {
                key: "developer-evaluation",
                title: "Evaluation",
                submenu: [
                    {key: "developer-view-testsets", title: "Test sets", link: `${P}/testsets`},
                    {
                        key: "developer-view-evaluators",
                        title: "Evaluators",
                        link: `${P}/evaluators`,
                    },
                    {
                        key: "developer-view-evaluations",
                        title: "Evaluation runs",
                        link: `${P}/evaluations`,
                    },
                    {
                        key: "developer-view-annotation-queues",
                        title: "Annotation Queues",
                        link: `${P}/annotations`,
                    },
                ],
            },
            {key: "mobile-observability", title: "Observability", link: `${P}/observability`},
        ])
    })

    it("beta developer mode lists no Endpoints, Archived apps or Registry row, as the old app", () => {
        const {afterHome, afterSessions} = developerNavSlots(P, DEVELOPER_VIEWS, true)
        const links = JSON.stringify(shape([...afterHome, ...afterSessions]))
        expect(links).not.toContain("/endpoints")
        expect(links).not.toContain("/apps/archived")
        expect(links).not.toContain("/variants")
    })

    it("beta developer mode turns off prefetch on every developer link", () => {
        const {afterHome, afterSessions} = developerNavSlots(P, DEVELOPER_VIEWS, true)
        const rows = [...afterHome, ...afterSessions].flatMap((item) => item.submenu ?? [item])
        expect(rows.every((row) => row.prefetch === false)).toBe(true)
    })

    it("beta developer mode leaves out the Evaluation group when none of its views is on", () => {
        const prompts = DEVELOPER_VIEWS.filter((view) => view.id === "prompts")
        expect(shape(developerNavSlots(P, prompts, true).afterSessions)).toEqual([
            {key: "mobile-observability", title: "Observability", link: `${P}/observability`},
        ])
    })

    it("without beta developer mode the rail keeps today's flat Developer section, unchanged", () => {
        const slots = developerNavSlots(P, DEVELOPER_VIEWS, false)
        expect(slots.afterHome).toEqual([])
        expect(shape(slots.afterSessions)).toEqual([
            {
                key: "developer-section-developer",
                title: "Developer",
                submenu: [
                    {
                        key: "developer-view-archived-apps",
                        title: "Archived apps",
                        link: `${P}/apps/archived`,
                    },
                    {key: "developer-view-endpoints", title: "Endpoints", link: `${P}/endpoints`},
                    {
                        key: "developer-view-evaluations",
                        title: "Evaluations",
                        link: `${P}/evaluations`,
                    },
                    {
                        key: "developer-view-annotation-queues",
                        title: "Annotation queues",
                        link: `${P}/annotations`,
                    },
                    {key: "developer-view-testsets", title: "Test sets", link: `${P}/testsets`},
                    {key: "developer-view-variants", title: "Variants", link: `${P}/variants`},
                    {key: "developer-view-prompts", title: "Prompts", link: `${P}/prompts`},
                    {
                        key: "developer-view-evaluators",
                        title: "Evaluators",
                        link: `${P}/evaluators`,
                    },
                ],
            },
        ])
        expect(slots.afterSessions[0].alwaysOpen).toBe(true)
    })

    it("without beta developer mode and no view on, the rail adds nothing", () => {
        expect(developerNavSlots(P, [], false)).toEqual({afterHome: [], afterSessions: []})
    })
})
