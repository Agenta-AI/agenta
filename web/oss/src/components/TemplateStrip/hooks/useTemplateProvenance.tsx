import {useCallback, useMemo, useRef, useState, type ReactNode} from "react"

import {
    AGENT_TEMPLATES,
    templateBuilderMessage,
    type AgentTemplate,
} from "@/oss/components/pages/agent-home/assets/templates"

import TemplateChip from "../components/TemplateChip"

interface ComposerApi {
    setText: (text: string) => void
    /** Current composer text, read at USE time to confirm the template seed wasn't edited away. */
    getText: () => string
}

/** Composer wrapper classes while a chip is docked (squared top-left corner, active border). */
const CHIPPED_COMPOSER_CLASS =
    "!rounded-[0px_14px_14px_14px] !border-[1.5px] !border-[var(--ag-colorPrimary)]"
/** Strip-era default composer classes (no chip). */
const DEFAULT_COMPOSER_CLASS =
    "!rounded-[14px] !border-[1.5px] !border-[var(--ag-strip-input-border)]"

/**
 * Per-composer provenance state: which template filled the composer. `pick` overwrites the
 * text; `clear` drops the chip AND the text. Editing the text keeps the chip showing
 * (provenance, not a lock) — but fully emptying it (via `onComposerTextChange`) drops
 * provenance too, and `resolveTemplateName` only credits the template at USE time if the text
 * still matches the seed verbatim. One instance per surface; never shared.
 */
export function useTemplateProvenance({composerApi}: {composerApi: ComposerApi}): {
    selectedTemplate: AgentTemplate | null
    selectedTemplateKey: string | null
    pick: (template: AgentTemplate) => void
    clear: () => void
    /** Wire to the composer's text-change signal (e.g. `RichChatInput`'s `onChange`) so a fully
     * emptied composer drops the chip too — a template pick must not survive its own erasure. */
    onComposerTextChange: (text: string) => void
    /** USE-time name resolution (Create-agent / commit): only returns the template's name when
     * the composer text still exactly matches what the pick seeded — any edit, partial or full,
     * means the agent is no longer "from" that template. Pass the current text when the caller
     * already has it (avoids reading a composer that was cleared earlier in the same handler). */
    resolveTemplateName: (currentText?: string) => string | undefined
    chipNode: ReactNode
    composerClassName: string
} {
    const [selectedTemplate, setSelectedTemplate] = useState<AgentTemplate | null>(null)

    // Ref'd so callers can pass an inline object literal without destabilizing `pick`.
    const apiRef = useRef(composerApi)
    apiRef.current = composerApi

    // The exact text `pick` seeded (trimmed), so USE-time can tell a verbatim template seed from
    // an edited one. Null when nothing is seeded (cleared, or never picked).
    const seededTextRef = useRef<string | null>(null)

    // Drop provenance without touching composer text — used when the text is already empty
    // (typed/deleted away) so we don't re-set already-empty content.
    const clearProvenance = useCallback(() => {
        seededTextRef.current = null
        setSelectedTemplate(null)
    }, [])

    const pick = useCallback((template: AgentTemplate) => {
        const seeded = templateBuilderMessage(template)
        apiRef.current.setText(seeded)
        seededTextRef.current = seeded.trim()
        setSelectedTemplate(template)
    }, [])

    // The chip's ✕ means "remove the template" — that includes the text it filled in, not just
    // the chip. Callers that already cleared the composer themselves (e.g. after a send) just
    // no-op here.
    const clear = useCallback(() => {
        apiRef.current.setText("")
        clearProvenance()
    }, [clearProvenance])

    // Live signal from the composer: once the user empties it (typing/deleting), the chip is
    // stale — drop it immediately rather than waiting for a create/submit to notice.
    const onComposerTextChange = useCallback(
        (text: string) => {
            if (!text.trim()) clearProvenance()
        },
        [clearProvenance],
    )

    // USE-time guarantee: empty text, or text that no longer matches the seed verbatim, can never
    // produce a template-derived name. Strict comparison (not "lightly edited") on purpose — simpler
    // and consistent across every create path.
    const resolveTemplateName = useCallback(
        (currentText?: string): string | undefined => {
            if (!selectedTemplate || seededTextRef.current === null) return undefined
            const current = (currentText ?? apiRef.current.getText()).trim()
            return current && current === seededTextRef.current ? selectedTemplate.name : undefined
        },
        [selectedTemplate],
    )

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
        onComposerTextChange,
        resolveTemplateName,
        chipNode,
        composerClassName: selectedTemplate ? CHIPPED_COMPOSER_CLASS : DEFAULT_COMPOSER_CLASS,
    }
}
