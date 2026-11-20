import type {ReactNode} from "react"

import type {SchemaProperty} from "@agenta/entities/shared"
import type {ViewDef} from "@agenta/ui/view-stack"
import {GearSix} from "@phosphor-icons/react"

import {SectionPageRow} from "../SectionPageRow"
import type {AdvancedViewParams} from "../views/advancedViews"

import {useAdvancedPartRows} from "./AdvancedPartRows"
import type {AgentTemplateT, ModelHarness, SectionIndicatorFor, SectionResult} from "./types"

export interface AdvancedSectionParams {
    t: AgentTemplateT
    mh: ModelHarness
    sectionIndicator: SectionIndicatorFor
    /** The inline "what changed" body. Null when the section is clean. */
    advancedChangeBody: ReactNode
    /** Opens "Advanced" (F04 f9): the list of its parts. */
    openAdvanced: () => void
    /** Opens one part's view, from the page's Advanced card. */
    openAdvancedPart: (view: ViewDef<AdvancedViewParams>) => void
    schema: SchemaProperty | null | undefined
    config: Record<string, unknown>
    revisionId: string | null
}

/** Advanced: a row that opens its view when clean, the changes not saved yet inline otherwise. */
export const advancedSection = ({
    t,
    mh,
    sectionIndicator,
    advancedChangeBody,
    openAdvanced,
    openAdvancedPart,
    schema,
    config,
    revisionId,
}: AdvancedSectionParams): SectionResult =>
    mh.hasAdvanced && {
        key: "advanced",
        icon: <GearSix size={14} />,
        title: t("entityUi.agentTemplate.advanced"),
        indicator: sectionIndicator("advanced"),
        // Never self-opening: nothing in Advanced blocks a run (see `needsProviderKeyInline`).
        defaultOpen: false,
        // No summary: the row names nothing (canvas S02, B03); its view lists the parts.
        // Changes not saved yet → show them inline (dropping `onOpen` is what expands a section).
        // Nothing changed → the row opens the view.
        // On the page: one row per part (canvas A04: Execution, Agenta tools).
        pageContent: (
            <AdvancedPageRows
                schema={schema}
                config={config}
                revisionId={revisionId}
                onOpen={openAdvancedPart}
            />
        ),
        ...(advancedChangeBody
            ? {content: advancedChangeBody}
            : {onOpen: openAdvanced, content: null}),
    }

const AdvancedPageRows = ({
    schema,
    config,
    revisionId,
    onOpen,
}: Pick<AdvancedSectionParams, "schema" | "config" | "revisionId"> & {
    onOpen: AdvancedSectionParams["openAdvancedPart"]
}) => {
    const rows = useAdvancedPartRows(schema, config, revisionId)
    return (
        <>
            {rows.map((row) => (
                <SectionPageRow
                    key={row.key}
                    icon={row.icon}
                    title={row.title}
                    summary={row.summary}
                    onClick={() => onOpen(row.view)}
                />
            ))}
        </>
    )
}
