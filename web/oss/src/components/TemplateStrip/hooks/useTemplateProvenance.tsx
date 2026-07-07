import {useCallback, useMemo, useRef, useState, type ReactNode} from "react"

import {
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

    const clear = useCallback(() => setSelectedTemplate(null), [])

    const chipNode = useMemo(
        () =>
            selectedTemplate ? <TemplateChip template={selectedTemplate} onClear={clear} /> : null,
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
