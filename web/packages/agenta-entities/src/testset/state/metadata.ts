/**
 * Testset Revision Header Metadata
 *
 * Read-only data for the header of a Testset revision view: Testset name, description
 * and slug, plus the revision slug, version, commit message, author and dates.
 *
 * Name, description and slug come from the Testset entity, not the revision. They change
 * through `updateTestsetMetadata`, which does not create a revision.
 */

import {atom} from "jotai"
import {atomFamily} from "jotai-family"

import {revisionMolecule} from "./revisionMolecule"
import {testsetMolecule} from "./testsetMolecule"

export interface TestsetRevisionHeader {
    testsetId: string
    testsetName: string
    testsetSlug: string | undefined
    description: string | undefined
    revisionSlug: string | undefined
    revisionVersion: number | undefined
    commitMessage: string | undefined
    author: string | undefined
    createdAt: string | undefined
    updatedAt: string | undefined
}

export interface TestsetRevisionHeaderState {
    /** Null until the revision has loaded. */
    data: TestsetRevisionHeader | null
    isPending: boolean
    isError: boolean
}

export const testsetRevisionHeaderAtomFamily = atomFamily((revisionId: string) =>
    atom((get): TestsetRevisionHeaderState => {
        const revisionQuery = get(revisionMolecule.query(revisionId))
        const revision = revisionQuery.data

        if (!revision) {
            return {
                data: null,
                isPending: revisionQuery.isPending,
                isError: revisionQuery.isError,
            }
        }

        const testset = get(testsetMolecule.query(revision.testset_id)).data

        return {
            data: {
                testsetId: revision.testset_id,
                testsetName: testset?.name ?? "",
                testsetSlug: testset?.slug ?? undefined,
                description: testset?.description ?? undefined,
                revisionSlug: revision.slug ?? undefined,
                revisionVersion: revision.version,
                commitMessage: revision.message ?? undefined,
                author: revision.author ?? undefined,
                createdAt: revision.created_at ?? undefined,
                updatedAt: revision.updated_at ?? undefined,
            },
            isPending: revisionQuery.isPending,
            isError: revisionQuery.isError,
        }
    }),
)
