import type {SessionView} from "@agenta/annotation"
import {testsetsListAtom, type Testset} from "@agenta/entities/testset"
import type {EntitySelectionAdapter, ListQueryState, SelectionPathItem} from "@agenta/entity-ui"
import type {Atom} from "jotai"

import type {AddToTestsetTargetSelection} from "./type"

export const SESSION_TABS: {key: SessionView; label: string}[] = [
    {key: "annotate", label: "Annotate"},
    {key: "list", label: "All Annotations"},
    {key: "configuration", label: "Configuration"},
]

export const TAB_ITEMS = SESSION_TABS.map((tab) => ({key: tab.key, label: tab.label}))

export const ADD_TO_TESTSET_COMMIT_MODES = [
    {id: "existing", label: "Existing testset"},
    {id: "new", label: "New testset"},
]

export const CREATE_TESTSET_FIELDS = {
    modes: ["new"],
    nameLabel: "Testset name",
    defaultName: ({entity}: {entity: {name?: string} | null}) => entity?.name ?? "",
}

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
    toSelection: (path: SelectionPathItem[], leafEntity: unknown): AddToTestsetTargetSelection => {
        const testset = leafEntity as Testset
        const id = testset.id
        const name = testset.name

        return {
            type: "testset",
            id,
            label: name,
            path,
            metadata: {
                testsetId: id,
                testsetName: name,
            },
        }
    },
    isComplete: (path: SelectionPathItem[]) => Boolean(path[0]?.id),
    emptyMessage: "No testsets found",
    loadingMessage: "Loading testsets...",
}
