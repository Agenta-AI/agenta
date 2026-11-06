import {useMemo} from "react"

import {useRouter} from "next/router"

import {useDeveloperViewEnabled} from "../../developer/developerViewAccess"

export interface RunReferenceLinks {
    /** The test set page of one revision; null when the test sets view is off. */
    testset: (revisionId: string) => string | null
    /** The variants page of the app with the revision open; null when the variants view is off. */
    variant: (appId: string, revisionId: string) => string | null
}

/** Links from the run summary to the test set and the variant it used, on pages /m has. */
export const useRunReferenceLinks = (): RunReferenceLinks => {
    const {query} = useRouter()
    const testsetsOn = useDeveloperViewEnabled("testsets") === true
    const variantsOn = useDeveloperViewEnabled("variants") === true
    const workspaceId = query.workspace_id
    const projectId = query.project_id
    const base =
        typeof workspaceId === "string" && typeof projectId === "string"
            ? `/w/${workspaceId}/p/${projectId}`
            : null

    return useMemo(
        () => ({
            testset: (revisionId) =>
                base && testsetsOn ? `${base}/testsets/${encodeURIComponent(revisionId)}` : null,
            variant: (appId, revisionId) =>
                base && variantsOn
                    ? `${base}/variants?app=${encodeURIComponent(appId)}&revisionId=${encodeURIComponent(revisionId)}`
                    : null,
        }),
        [base, testsetsOn, variantsOn],
    )
}
