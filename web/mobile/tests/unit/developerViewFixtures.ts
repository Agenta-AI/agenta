import {FlaskIcon} from "@phosphor-icons/react"

import type {DeveloperView} from "@/features/developer/developerViews"

/**
 * Test-only registry: one page per stage, and one feature gate (no routes, no nav link) in
 * preview. Tests swap it in with `vi.mock`.
 */
export const TEST_DEVELOPER_VIEWS: readonly DeveloperView[] = [
    {
        id: "lab-hidden",
        routes: ["/lab-hidden"],
        label: "Lab hidden",
        description: "Show the hidden lab page.",
        nav: {icon: FlaskIcon, section: "developer"},
        stage: "hidden",
    },
    {
        id: "lab-preview",
        routes: ["/lab-preview", "/lab-preview/[item_id]"],
        label: "Lab preview",
        description: "Show the preview lab page.",
        nav: {icon: FlaskIcon, section: "developer"},
        stage: "preview",
    },
    {
        id: "lab-on",
        routes: ["/lab-on"],
        label: "Lab on",
        description: "Show the on lab page.",
        nav: {icon: FlaskIcon, section: "developer"},
        stage: "on",
    },
    {
        id: "lab-gate",
        label: "Lab gate",
        description: "Show the lab action on a shared screen.",
        stage: "preview",
    },
]
