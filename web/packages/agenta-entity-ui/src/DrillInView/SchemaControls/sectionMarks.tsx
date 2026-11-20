/**
 * Section marks: a container can mark config sections of the agent panel, for example the
 * builder page's "Changed by the builder" (task 41.2). "Mark" here is a container's note after a
 * section title; the panel's own section indicators (draft and agent changes) are separate. The
 * container provides the marked section keys, the mark's text and a callback for when the person
 * opens or uses a marked section (a click or Enter in it); the panel draws the mark after the
 * section title. A section that opens by itself (the first reveal, a list that fills) does not
 * count. Without a provider nothing is marked.
 */
import {createContext, useContext} from "react"

import type {AgentTemplateSectionDescriptor} from "./agentTemplate/AgentTemplateSectionList"
import type {PanelSectionKey} from "./agentTemplate/sectionChanges"

/** The panel's section keys: its accordion keys and Secrets. */
export type MarkableSectionKey = PanelSectionKey | "secrets"

export interface SectionMarks {
    keys: ReadonlySet<MarkableSectionKey>
    label: string
    /** The person opened or used a marked section. */
    onOpened: (key: MarkableSectionKey) => void
}

export const SectionMarksContext = createContext<SectionMarks | null>(null)

const Mark = ({label}: {label: string}) => (
    <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-[var(--ag-colorInfo)]">
        <span aria-hidden className="size-[7px] rounded-full bg-[var(--ag-colorInfo)]" />
        {label}
    </span>
)

/**
 * The sections with the container's marks applied, and the handlers for the panel's root: a
 * pointer down or Enter / Space inside a marked section reports it (each section carries its
 * key in `data-config-section`).
 */
export const useSectionMarks = (sections: AgentTemplateSectionDescriptor[]) => {
    const marks = useContext(SectionMarksContext)
    const report = (target: EventTarget | null) => {
        if (!marks || !(target instanceof Element)) return
        const key = target.closest<HTMLElement>("[data-config-section]")?.dataset.configSection
        if (key && marks.keys.has(key as MarkableSectionKey))
            marks.onOpened(key as MarkableSectionKey)
    }
    const handlers = {
        onPointerDownCapture: (event: {target: EventTarget | null}) => report(event.target),
        onKeyDownCapture: (event: {key: string; target: EventTarget | null}) => {
            if (event.key === "Enter" || event.key === " ") report(event.target)
        },
    }
    if (!marks?.keys.size) return {sections, handlers}
    return {
        handlers,
        sections: sections.map((section) =>
            marks.keys.has(section.key as MarkableSectionKey)
                ? {
                      ...section,
                      titleBadge: (
                          <span className="flex items-center gap-2">
                              {section.titleBadge}
                              <Mark label={marks.label} />
                          </span>
                      ),
                  }
                : section,
        ),
    }
}
