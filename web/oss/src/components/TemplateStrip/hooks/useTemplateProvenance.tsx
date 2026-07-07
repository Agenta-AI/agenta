import {useCallback, useMemo, useRef, useState, type ReactNode} from "react"

import {
    AGENT_TEMPLATES,
    templateBuilderMessage,
    type AgentTemplate,
} from "@/oss/components/pages/agent-home/assets/templates"

import TemplateChip from "../components/TemplateChip"

interface ComposerApi {
    setText: (text: string) => void
}

/** Composer wrapper classes while a chip is docked (squared top-left corner, active border). */
const CHIPPED_COMPOSER_CLASS =
    "!rounded-[0px_14px_14px_14px] !border-[1.5px] !border-[var(--ag-colorPrimary)]"
/** Strip-era default composer classes (no chip). */
const DEFAULT_COMPOSER_CLASS =
    "!rounded-[14px] !border-[1.5px] !border-[var(--ag-strip-input-border)]"

/**
 * Per-composer provenance state: which template filled the composer. `pick` overwrites the
 * text (prototype behavior); `clear` drops the chip only — the text stays. Editing the text
 * keeps the chip (provenance, not a lock). One instance per surface; never shared.
 */
export function useTemplateProvenance({composerApi}: {composerApi: ComposerApi}): {
    selectedTemplate: AgentTemplate | null
    selectedTemplateKey: string | null
    pick: (template: AgentTemplate) => void
    clear: () => void
    chipNode: ReactNode
    composerClassName: string
} {
    const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null)

    // Ref'd so callers can pass an inline object literal without destabilizing `pick`.
    const apiRef = useRef(composerApi)
    apiRef.current = composerApi

    const pick = useCallback((template: AgentTemplate) => {
        apiRef.current.setText(templateBuilderMessage(template))
        setSelectedTemplate(template)
    }, [])

    // The chip's ✕ means "remove the template" — that includes the text it filled in, not just
    // the chip. Callers that already cleared the composer themselves (e.g. after a send) just
    // no-op here.
    const clear = useCallback(() => {
        apiRef.current.setText("")
        setSelectedTemplate(null)
    }, [])

    // Always render a chip (never null) so its box reserves the same height whether or not a
    // template is selected — picking/clearing never shifts the composer below it. When nothing
    // is selected, render the first registry template purely for sizing and hide it with
    // `invisible` (keeps layout, no paint) rather than guessing a pixel height.
    const chipNode = useMemo(
        () => (
            <div
                className={selectedTemplate ? undefined : "invisible"}
                // `inert` (not just `invisible`) also drops the placeholder's ✕ button from
                // tab order and the a11y tree — it's not really there.
                inert={!selectedTemplate}
            >
                <TemplateChip template={selectedTemplate ?? AGENT_TEMPLATES[0]} onClear={clear} />
            </div>
        ),
        [selectedTemplate, clear],
    )

    return {
        selectedTemplate,
        selectedTemplateKey: selectedTemplate?.key ?? null,
        pick,
        clear,
        chipNode,
        composerClassName: selectedTemplate ? CHIPPED_COMPOSER_CLASS : DEFAULT_COMPOSER_CLASS,
    }
}
