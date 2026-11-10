import {runReferencesAtomFamily} from "@agenta/entities/evaluationRun"
import {testsetQueryAtomFamily} from "@agenta/entities/testset"
import {useAtomValue} from "jotai"

const TestsetName = ({testsetId}: {testsetId: string}) => {
    const name = useAtomValue(testsetQueryAtomFamily(testsetId)).data?.name
    return (
        <span className="max-w-[160px] truncate rounded-control-sm bg-muted px-1.5 py-0.5 text-xs text-foreground">
            {name ?? testsetId}
        </span>
    )
}

/** "Test set:" and the test sets of the base run, which every candidate shares. */
export const CompareTestsetNames = ({runId}: {runId: string}) => {
    const testsets = useAtomValue(runReferencesAtomFamily(runId))?.testsets ?? []
    return (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
            <span className="shrink-0 text-xs text-muted-foreground">Test set:</span>
            {testsets.length ? (
                testsets.map((testset) => (
                    <TestsetName key={testset.testsetId} testsetId={testset.testsetId} />
                ))
            ) : (
                <span className="text-xs text-muted-foreground">—</span>
            )}
        </span>
    )
}
