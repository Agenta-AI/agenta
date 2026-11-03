import {useEffect} from "react"

import type {RunTestsetReference} from "@agenta/entities/evaluationRun"
import {revisionMolecule, testsetQueryAtomFamily} from "@agenta/entities/testset"
import {Badge, SkeletonBlock} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {ConfigRows, type ConfigRowData} from "./ConfigRows"

const MISSING = "—"

/** The rows of one test set: its name, how many test cases it has, its columns and description. */
export const TestsetRows = ({
    projectId,
    testset,
}: {
    projectId: string
    testset: RunTestsetReference
}) => {
    const testsetQuery = useAtomValue(testsetQueryAtomFamily(testset.testsetId))
    const revisionId = testset.revisionId ?? ""
    const revisionQuery = useAtomValue(revisionMolecule.query(revisionId))
    const enableTestcases = useSetAtom(revisionMolecule.atoms.enableWithTestcases)
    const columns = useAtomValue(revisionMolecule.atoms.testcaseColumns(revisionId))

    // The columns come from the test cases, which a revision loads only when asked.
    useEffect(() => {
        if (revisionId) enableTestcases({revisionId, projectId})
    }, [enableTestcases, revisionId, projectId])

    const caseCount = revisionQuery.data?.data?.testcase_ids?.length
    const description = testsetQuery.data?.description?.trim()
    const columnsPending = revisionId && revisionQuery.isPending

    const rows: ConfigRowData[] = [
        {
            key: "name",
            label: "Test set",
            value: testsetQuery.data?.name ? (
                <Badge variant="outlined">{testsetQuery.data.name}</Badge>
            ) : testsetQuery.isPending ? (
                <SkeletonBlock className="h-5 w-32" />
            ) : (
                MISSING
            ),
        },
        {
            key: "cases",
            label: "Test cases",
            value: caseCount === undefined ? MISSING : caseCount,
        },
        {
            key: "columns",
            label: "Columns",
            value:
                columns.length > 0 ? (
                    <ul className="m-0 flex list-none flex-wrap gap-1 p-0">
                        {columns.map((column) => (
                            <li key={column}>
                                <Badge variant="outlined" className="font-mono">
                                    {column}
                                </Badge>
                            </li>
                        ))}
                    </ul>
                ) : columnsPending ? (
                    <SkeletonBlock className="h-5 w-40" />
                ) : (
                    <span className="text-muted-foreground">No column metadata.</span>
                ),
        },
    ]
    if (description) rows.push({key: "description", label: "Description", value: description})
    return <ConfigRows rows={rows} />
}
