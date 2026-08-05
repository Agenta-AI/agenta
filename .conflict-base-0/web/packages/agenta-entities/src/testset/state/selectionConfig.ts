import {projectIdAtom} from "@agenta/shared/state"
import {getDefaultStore} from "jotai"

import {revisionMolecule} from "./revisionMolecule"
import {enableRevisionsListQueryAtom} from "./store"
import {testsetMolecule} from "./testsetMolecule"

/**
 * Pre-built selection config for entity selection system.
 * Use this with initializeSelectionSystem() to configure testset selection.
 *
 * @example
 * ```typescript
 * import { testsetSelectionConfig } from '@agenta/entities/testset'
 *
 * initializeSelectionSystem({
 *   testset: testsetSelectionConfig,
 *   // ... other configs
 * })
 * ```
 */
export const testsetSelectionConfig = {
    testsetsListAtom: testsetMolecule.atoms.list(null as unknown as string),
    revisionsListFamily: (testsetId: string) => revisionMolecule.atoms.list(testsetId),
    enableRevisionsQuery: (testsetId: string) => {
        const store = getDefaultStore()
        const projectId = store.get(projectIdAtom)
        if (projectId) {
            store.set(enableRevisionsListQueryAtom, {testsetId, projectId})
        }
    },
}

export type TestsetSelectionConfig = typeof testsetSelectionConfig
