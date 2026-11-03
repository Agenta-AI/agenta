import {testsetsListAtom, type Testset} from "@agenta/entities/testset"
import type {
    EntitySelectionAdapter,
    EntitySelectionResult,
    ListQueryState,
    SelectionPathItem,
} from "@agenta/entity-ui/selection"
import type {Atom} from "jotai"

export interface AddToTestsetTargetSelection extends EntitySelectionResult<{
    testsetId: string
    testsetName: string
}> {
    type: "testset"
    metadata: {testsetId: string; testsetName: string}
}

/** One level, the project's testsets: the target an annotation export appends rows to. */
export const ADD_TO_TESTSET_TARGET_ADAPTER: EntitySelectionAdapter<AddToTestsetTargetSelection> = {
    name: "annotation-add-to-testset-target",
    entityType: "testset",
    hierarchy: {
        selectableLevel: 0,
        levels: [
            {
                type: "testset",
                label: "Testset",
                listAtom: testsetsListAtom as unknown as Atom<ListQueryState<Testset>>,
                getId: (testset: unknown) => (testset as Testset).id,
                getLabel: (testset: unknown) => (testset as Testset).name,
                getDescription: (testset: unknown) => (testset as Testset).description ?? undefined,
                hasChildren: () => false,
                isSelectable: () => true,
            },
        ],
    },
    toSelection: (path: SelectionPathItem[], leaf: unknown): AddToTestsetTargetSelection => {
        const testset = leaf as Testset
        return {
            type: "testset",
            id: testset.id,
            label: testset.name,
            path,
            metadata: {testsetId: testset.id, testsetName: testset.name},
        }
    },
    isComplete: (path: SelectionPathItem[]) => Boolean(path[0]?.id),
    emptyMessage: "No testsets found",
    loadingMessage: "Loading testsets...",
}
