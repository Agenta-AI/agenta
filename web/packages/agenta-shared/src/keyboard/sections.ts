import type {SectionDefinition, SectionId} from "./types"

const section = (id: string): SectionId => id as SectionId

export const SECTION_IDS = {
    sessions: section("sessions"),
    composer: section("composer"),
    slashCommands: section("slashCommands"),
    agentGates: section("agentGates"),
    contextAndFiles: section("contextAndFiles"),
    configPanel: section("configPanel"),
} as const

/**
 * How the shortcuts reference groups its rows. A section is a place a user would look, which is
 * why the three HITL docks share one: they are three components, but one moment.
 */
export const SECTIONS: readonly SectionDefinition[] = [
    {
        id: SECTION_IDS.sessions,
        title: "Sessions",
        summary: "Managing the conversations open in the agent playground.",
        order: 10,
    },
    {id: SECTION_IDS.composer, title: "Writing a message", order: 20},
    {id: SECTION_IDS.slashCommands, title: "Slash commands", order: 30},
    {
        id: SECTION_IDS.agentGates,
        title: "When the agent asks you something",
        summary: "If several prompts are waiting, the topmost one answers first.",
        order: 40,
    },
    {id: SECTION_IDS.contextAndFiles, title: "Context rail and files", order: 50},
    {id: SECTION_IDS.configPanel, title: "Agent configuration", order: 60},
]

export const SECTIONS_BY_ID: ReadonlyMap<SectionId, SectionDefinition> = new Map(
    SECTIONS.map((entry) => [entry.id, entry]),
)
