/**
 * Section marks: a container can mark config sections of the agent panel, for example the
 * builder page's "Changed by the builder" (task 41.2). The container provides the marked section
 * keys, the mark's text and a callback for when the person opens a marked section; the panel
 * draws the mark after the section title. Without a provider nothing is marked.
 */
import {createContext, useContext, useEffect, useRef} from "react"

import {useAccordionSectionOpen} from "@agenta/ui/components/presentational"

import type {AgentTemplateSectionDescriptor} from "./agentTemplate/AgentTemplateSectionList"

export interface SectionMarks {
    /** Section keys as the panel names them (`instructions`, `model-harness`, `tools`, ...). */
    keys: ReadonlySet<string>
    label: string
    /** The person opened a marked section. */
    onOpened: (key: string) => void
}

export const SectionMarksContext = createContext<SectionMarks | null>(null)

const Mark = ({label}: {label: string}) => (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-[var(--ag-colorInfo)]">
        <span aria-hidden className="size-[7px] rounded-full bg-[var(--ag-colorInfo)]" />
        {label}
    </span>
)

/** Reports a section that goes from closed to open; a section open from the start does not count. */
const OpenWatch = ({onOpened}: {onOpened: () => void}) => {
    const open = useAccordionSectionOpen()
    const before = useRef(open)
    useEffect(() => {
        if (open && !before.current) onOpened()
        before.current = open
    }, [open, onOpened])
    return null
}

/** The sections with the container's marks applied. */
export const useMarkedSections = (
    sections: AgentTemplateSectionDescriptor[],
): AgentTemplateSectionDescriptor[] => {
    const marks = useContext(SectionMarksContext)
    if (!marks?.keys.size) return sections
    return sections.map((section) => {
        if (!marks.keys.has(section.key)) return section
        const opened = () => marks.onOpened(section.key)
        return {
            ...section,
            titleBadge: (
                <span className="flex items-center gap-2">
                    {section.titleBadge}
                    <Mark label={marks.label} />
                </span>
            ),
            onOpen: section.onOpen
                ? () => {
                      opened()
                      section.onOpen?.()
                  }
                : undefined,
            content: (
                <>
                    <OpenWatch onOpened={opened} />
                    {section.content}
                </>
            ),
        }
    })
}
