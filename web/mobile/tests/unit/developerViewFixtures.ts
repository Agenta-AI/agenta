import {FlaskIcon} from "@phosphor-icons/react"

import type {DeveloperView} from "@/features/developer/developerViews"

/**
 * Test-only registry: two pages with a nav link, and one feature gate (no routes, no nav link).
 * Tests swap it in with `vi.mock`.
 */
export const TEST_DEVELOPER_VIEWS: readonly DeveloperView[] = [
    {
        id: "lab-one",
        routes: ["/lab-one"],
        label: "Lab one",
        nav: {icon: FlaskIcon, section: "developer"},
    },
    {
        id: "lab-two",
        routes: ["/lab-two", "/lab-two/[item_id]"],
        label: "Lab two",
        nav: {icon: FlaskIcon, section: "developer"},
    },
    {
        id: "lab-gate",
        label: "Lab gate",
    },
]
