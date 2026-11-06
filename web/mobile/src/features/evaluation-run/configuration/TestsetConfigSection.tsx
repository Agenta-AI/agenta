import type {RunTestsetReference} from "@agenta/entities/evaluationRun"

import {ConfigSection} from "./ConfigSection"
import {TestsetRows} from "./TestsetRows"

/** The Test set section: one block of rows per test set the run reads. Hidden with none. */
export const TestsetConfigSection = ({
    projectId,
    testsets,
    idSuffix = "",
}: {
    projectId: string
    testsets: readonly RunTestsetReference[]
    /** Keeps the section id unique when several runs show side by side. */
    idSuffix?: string
}) => {
    if (testsets.length === 0) return null
    return (
        <ConfigSection
            id={`config-testset${idSuffix}`}
            title="Test set"
            subtitle={testsets.length > 1 ? `${testsets.length} test sets` : null}
        >
            {testsets.map((testset) => (
                <TestsetRows
                    key={`${testset.testsetId}:${testset.revisionId}`}
                    projectId={projectId}
                    testset={testset}
                />
            ))}
        </ConfigSection>
    )
}
