import {atom} from "jotai"

import {currentRevisionIdAtom} from "@/oss/state/entities/testset"
import {getValueAtPath} from "@/oss/state/entities/trace"

import {cascaderValueAtom, resetCascaderStateAtom, selectedTestsetInfoAtom} from "./cascaderState"
import {
    onRevisionSelectAtom,
    onTestsetSelectAtom,
    resetForCascaderChangeAtom,
    selectedRevisionIdAtom,
} from "./drawerState"
import {clearLocalEntitiesAtom} from "./localEntities"
import {resetSaveStateAtom} from "./saveState"
import {selectedTestsetIdAtom} from "./testsetQueries"

/**
 * Unified Action Atoms
 *
 * This file contains action atoms that need to import from multiple atom files.
 * Keeping them separate avoids circular dependency issues.
 */

/**
 * Write atom: Handle cascader change - unified action for entire selection flow
 *
 * This is the main entry point for cascader selection. It handles:
 * 1. Resetting all relevant state (drawer, save, local entities)
 * 2. Updating cascader state based on selection
 * 3. Triggering auto-mapping and entity creation
 *
 * Called directly from UI - hook just passes through to this atom.
 */
export const onCascaderChangeAtom = atom(
    null,
    (
        get,
        set,
        params: {
            value: string[]
            selectedOptions: any[]
        },
    ) => {
        const {value, selectedOptions} = params

        if (!value || value.length === 0) {
            return {success: false, reason: "empty_value"}
        }

        // 1. Reset all state
        set(clearLocalEntitiesAtom)
        set(resetForCascaderChangeAtom)
        set(resetSaveStateAtom)
        set(resetCascaderStateAtom)
        set(selectedRevisionIdAtom, "")

        // 2. Handle "Create New" selection
        if (value[0] === "create") {
            set(selectedTestsetInfoAtom, {name: "Create New", id: "create"})
            set(selectedTestsetIdAtom, "create")
            set(selectedRevisionIdAtom, "draft")
            set(currentRevisionIdAtom, "draft")
            set(cascaderValueAtom, ["create"])
            return {success: true, action: "create_new"}
        }

        // 3. Handle testset selection
        const testsetId = value[0]
        const revisionId = value.length > 1 ? value[1] : null
        const testsetName =
            typeof selectedOptions[0]?.label === "string"
                ? selectedOptions[0].label
                : "Selected testset"

        // Set testset info
        set(selectedTestsetIdAtom, testsetId)
        set(selectedTestsetInfoAtom, {name: testsetName, id: testsetId})

        if (revisionId) {
            // Revision explicitly selected
            set(selectedRevisionIdAtom, revisionId)
            set(currentRevisionIdAtom, revisionId)
            set(cascaderValueAtom, [testsetId, revisionId])
        } else {
            // Only testset clicked - auto-select latest revision from cascader children
            const testsetOption = selectedOptions[0]
            const revisionChildren = testsetOption?.children || []
            const latestRevision =
                revisionChildren.find((r: any) => r.value !== "draft") || revisionChildren[0]

            if (latestRevision) {
                set(selectedRevisionIdAtom, latestRevision.value)
                set(currentRevisionIdAtom, latestRevision.value)
                set(cascaderValueAtom, [testsetId, latestRevision.value])
            } else {
                // Revisions not loaded yet - will be handled by effect in hook
                set(cascaderValueAtom, [testsetId])
            }
        }

        // 4. Trigger auto-mapping and entity creation
        set(onTestsetSelectAtom)
        set(onRevisionSelectAtom, getValueAtPath)

        return {success: true, action: "selected", testsetId, revisionId}
    },
)
