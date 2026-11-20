import type {BuilderTab} from "../../../mobile/src/features/builder-page/builderTabs"

/**
 * The builder tabs of canvas frame B03: the five parts the builder built in the chat "Lead
 * outreach system". "Email writer" is active; the last two do not fit and go under "2 more".
 */
export const B03_TABS: BuilderTab[] = [
    {kind: "agent", id: "agent-lead-finder", name: "Lead finder", dot: false},
    {kind: "agent", id: "agent-email-writer", name: "Email writer", dot: false},
    {kind: "automation", id: "automation-every-day", name: "Every day 09:00", dot: false},
    {kind: "tool", id: "tool-enrich-company", name: "enrich_company", dot: false},
    {kind: "app", id: "app-lead-form", name: "Lead form", dot: false},
]

export const B03_ACTIVE = "agent:agent-email-writer"
