/**
 * FieldsDetectionContext
 *
 * Provides a callback for auto-detecting field paths from testcase data.
 * Used by FieldsTagsEditorControl to render a "Detect from testcase" button.
 *
 * PlaygroundConfigSection provides the callback when the evaluator has
 * a fields_tags_editor control, reading testcase data from the molecule layer.
 */

import {createContext, useContext} from "react"

export interface FieldsDetectionContextValue {
    /**
     * Detect field paths from the current testcase data.
     * Returns an array of dot-notation field paths, or null if detection is not available.
     */
    detectFieldsFromTestcase?: () => string[] | null
    /**
     * Whether testcase data is currently available for detection.
     * Used to control the enabled/disabled state of the detect button.
     */
    hasTestcaseData?: boolean
}

const FieldsDetectionContext = createContext<FieldsDetectionContextValue>({})

export const FieldsDetectionProvider = FieldsDetectionContext.Provider

export function useFieldsDetection(): FieldsDetectionContextValue {
    return useContext(FieldsDetectionContext)
}
