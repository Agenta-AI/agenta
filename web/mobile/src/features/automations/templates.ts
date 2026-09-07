import {CalendarCheck, Kanban, SunHorizon, type Icon} from "@phosphor-icons/react"

/**
 * The three starting points offered to someone with no automations yet.
 *
 * They are examples, not presets: each one names a job in the reader's words rather than a
 * trigger type, because "every morning digest" is a thing you want and "cron schedule" is not.
 * W5 seeds a draft from the picked `id`, so the list lives here rather than inside the empty
 * state that renders it.
 */
export interface AutomationTemplate {
    /** What `?template=` carries to the draft screen. */
    id: string
    icon: Icon
    title: string
    body: string
}

export const AUTOMATION_TEMPLATES: AutomationTemplate[] = [
    {
        id: "morning-digest",
        icon: SunHorizon,
        title: "Every morning digest",
        body: "A short summary of what changed overnight, in your inbox before you start.",
    },
    {
        id: "new-issue",
        icon: Kanban,
        title: "When a new issue arrives",
        body: "An agent reads it, tidies the description and suggests who should own it.",
    },
    {
        id: "weekly-report",
        icon: CalendarCheck,
        title: "Weekly report",
        body: "One message each Monday with the numbers you keep asking for.",
    },
]
