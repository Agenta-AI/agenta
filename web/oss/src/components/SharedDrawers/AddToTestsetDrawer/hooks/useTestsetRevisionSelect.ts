import {useCallback, useEffect, useMemo} from "react"

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
    selectedTestsetInfoAtom,
} from "../atoms/cascaderState"
import {selectedRevisionIdAtom} from "../atoms/drawerState"
import {
    selectedTestsetIdAtom,
    testsetRevisionsQueryFamily,
    testsetsListQueryAtom,
} from "../atoms/testsetQueries"
import {buildSelectedRevisionLabel} from "../components/RevisionLabel"

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
    const availableRevisions = useAtomValue(availableRevisionsAtom)
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
    // Check both query data and shared availableRevisions (populated by cascader loadData)
    useEffect(() => {
        if (selectedTestsetId && selectedTestsetId !== "create" && !selectedRevisionId) {
            // Try query data first, then fall back to shared availableRevisions
            const revisions = revisionsQuery.data?.length
                ? revisionsQuery.data
                : availableRevisions?.length
                  ? availableRevisions
                  : null

            if (revisions && revisions.length > 0) {
                const latestRevision = revisions[0]
                if (latestRevision?.id) {
                    setSelectedRevisionId(latestRevision.id)
                    setCurrentRevisionId(latestRevision.id)
                    setCascaderValue([selectedTestsetId, latestRevision.id])
                }
            }
        }
    }, [
        selectedTestsetId,
        revisionsQuery.data,
        availableRevisions,
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

    // Custom render function that can look up version from availableRevisions
    // when revisionMeta is not available (e.g., programmatic selection)
    const renderSelectedRevisionLabel = useMemo(() => {
        return (labels: string[], selectedOptions?: any[]): React.ReactNode => {
            if (!selectedOptions || selectedOptions.length === 0) {
                return labels.join(" / ")
            }

            // Use textLabel (preserved original string) or fall back to labels array
            const baseLabel =
                typeof selectedOptions[0]?.textLabel === "string"
                    ? selectedOptions[0].textLabel
                    : typeof labels?.[0] === "string"
                      ? labels[0]
                      : "Selected testset"

            const revisionOption = selectedOptions[selectedOptions.length - 1]
            let revisionVersion = revisionOption?.revisionMeta?.version

            // If version not in selectedOptions, look it up from availableRevisions
            if (!revisionVersion && selectedRevisionId && availableRevisions?.length) {
                const revision = availableRevisions.find((r) => r.id === selectedRevisionId)
                revisionVersion = revision?.version
            }

            if (!revisionVersion) {
                return baseLabel
            }

            return buildSelectedRevisionLabel(baseLabel, revisionVersion)
        }
    }, [availableRevisions, selectedRevisionId])

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
