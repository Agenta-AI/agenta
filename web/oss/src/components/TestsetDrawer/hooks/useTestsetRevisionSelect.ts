import {useCallback, useEffect} from "react"

import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {currentRevisionIdAtom} from "@/oss/state/entities/testset"

import {
    availableRevisionsAtom,
    cascaderOptionsWithChildrenAtom,
    cascaderValueAtom,
    isNewTestsetAtom,
    loadingRevisionsAtom,
    loadRevisionsAtom,
    newTestsetNameAtom,
    renderSelectedRevisionLabel,
    selectedTestsetInfoAtom,
} from "../atoms/cascaderState"
import {selectedRevisionIdAtom} from "../atoms/drawerState"
import {
    selectedTestsetIdAtom,
    testsetRevisionsQueryFamily,
    testsetsListQueryAtom,
} from "../atoms/testsetQueries"

/**
 * Hook for testset/revision selection via cascader
 *
 * Uses atoms for state management to prevent prop drilling.
 * Components can use this hook or directly access the atoms.
 */
export function useTestsetRevisionSelect() {
    // Entity mutations
    const setCurrentRevisionId = useSetAtom(currentRevisionIdAtom)

    // Cascader state atoms
    const [cascaderOptions, setCascaderOptions] = useAtom(cascaderOptionsWithChildrenAtom)
    const [cascaderValue, setCascaderValue] = useAtom(cascaderValueAtom)
    const [loadingRevisions] = useAtom(loadingRevisionsAtom)
    const [newTestsetName, setNewTestsetName] = useAtom(newTestsetNameAtom)
    const [testset, setTestset] = useAtom(selectedTestsetInfoAtom)
    const [availableRevisions, setAvailableRevisions] = useAtom(availableRevisionsAtom)
    const isNewTestset = useAtomValue(isNewTestsetAtom)

    // Drawer state atoms
    const [selectedRevisionId, setSelectedRevisionId] = useAtom(selectedRevisionIdAtom)
    const [selectedTestsetId, setSelectedTestsetId] = useAtom(selectedTestsetIdAtom)

    // Query atoms
    const testsetsQuery = useAtomValue(testsetsListQueryAtom)
    const revisionsQuery = useAtomValue(testsetRevisionsQueryFamily(selectedTestsetId))

    // Action atoms
    const executeLoadRevisions = useSetAtom(loadRevisionsAtom)

    const isTestsetsLoading = testsetsQuery.isPending

    // Auto-select latest revision when revisions load and none is selected
    useEffect(() => {
        if (
            selectedTestsetId &&
            selectedTestsetId !== "create" &&
            revisionsQuery.data?.length &&
            !selectedRevisionId
        ) {
            const latestRevision = revisionsQuery.data[0]
            if (latestRevision) {
                setSelectedRevisionId(latestRevision.id)
                setCurrentRevisionId(latestRevision.id)
                setCascaderValue([selectedTestsetId, latestRevision.id])
            }
        }
    }, [
        selectedTestsetId,
        revisionsQuery.data,
        selectedRevisionId,
        setSelectedRevisionId,
        setCurrentRevisionId,
        setCascaderValue,
    ])

    // Dynamic revision loading for cascader
    const loadRevisions = useCallback(
        async (selectedOptions: any[]) => {
            const targetOption = selectedOptions[selectedOptions.length - 1]
            if (!targetOption || targetOption.value === "create") {
                return
            }
            await executeLoadRevisions(targetOption.value)
        },
        [executeLoadRevisions],
    )

    // Custom select options for column mapping (Create New + divider)
    const customSelectOptions = useCallback((divider = true) => {
        return [
            {value: "create", label: "Create New"},
            ...(divider
                ? [
                      {
                          value: "divider",
                          label: "---",
                          className: "!p-0 !m-0 !min-h-0.5 !cursor-default",
                          disabled: true,
                      },
                  ]
                : []),
        ]
    }, [])

    return {
        // State (read from atoms)
        cascaderOptions,
        cascaderValue,
        loadingRevisions,
        newTestsetName,
        testset,
        availableRevisions,
        isNewTestset,
        selectedRevisionId,
        selectedTestsetId,
        isTestsetsLoading,
        revisionsQuery,

        // Setters (write to atoms)
        setCascaderOptions,
        setCascaderValue,
        setNewTestsetName,
        setTestset,
        setAvailableRevisions,
        setSelectedRevisionId,
        setSelectedTestsetId,
        setCurrentRevisionId,

        // Handlers
        loadRevisions,
        renderSelectedRevisionLabel,
        customSelectOptions,

        // Query refetch
        refetchTestsets: testsetsQuery.refetch,
    }
}
