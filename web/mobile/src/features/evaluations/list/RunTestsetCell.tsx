import {testsetMolecule} from "@agenta/entities/testset"
import {useAtomValue} from "jotai"

import type {RunReferences} from "./runReferences"
import {RunVersionChip} from "./RunVersionChip"

/** The test set a run used, with its revision: "Capitals v3". */
export const RunTestsetCell = ({refs}: {refs: RunReferences}) => {
    // The empty id keeps the hook count steady for a run with no test set.
    const testset = useAtomValue(testsetMolecule.selectors.data(refs.testsetId ?? ""))
    if (!refs.testsetId) return <span className="text-[13px] text-muted-foreground">—</span>
    return (
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            <span className="truncate">{testset?.name || "—"}</span>
            <RunVersionChip version={refs.testsetRevisionVersion} />
        </span>
    )
}
