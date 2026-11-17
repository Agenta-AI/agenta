import {
    appWorkflowsListQueryStateAtom,
    workflowVariantsListDataAtomFamily,
} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import type {RunReferences} from "./runReferences"
import {RunVersionChip} from "./RunVersionChip"

/** The app a run evaluated and, under it, the variant and revision: "Capital finder / verbose v5". */
export const RunApplicationCell = ({refs}: {refs: RunReferences}) => {
    const apps = useAtomValue(appWorkflowsListQueryStateAtom)
    // One variants list per app, shared by every row of that app.
    const variants = useAtomValue(workflowVariantsListDataAtomFamily(refs.applicationId ?? ""))
    const app = refs.applicationId
        ? apps.data.find((entry) => entry.id === refs.applicationId)
        : undefined
    const variant = refs.applicationVariantId
        ? variants.find((entry) => entry.id === refs.applicationVariantId)
        : undefined
    const variantName = variant?.name || variant?.slug || null

    if (!refs.applicationId) return <span className="text-[13px] text-muted-foreground">—</span>
    return (
        <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-[13px] text-muted-foreground">
                {app ? app.name || app.slug || "—" : "—"}
            </span>
            {variantName || refs.applicationRevisionVersion ? (
                <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
                    {variantName ? <span className="truncate">{variantName}</span> : null}
                    <RunVersionChip version={refs.applicationRevisionVersion} />
                </span>
            ) : null}
        </span>
    )
}
