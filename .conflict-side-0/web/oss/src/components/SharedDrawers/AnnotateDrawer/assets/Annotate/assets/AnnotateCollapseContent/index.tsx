import {memo} from "react"

import {AnnotationFieldRenderer} from "@/oss/components/EvalRunDetails/components/views/SingleScenarioViewerPOC/ScenarioAnnotationPanel/AnnotationInputs"

import {AnnotateCollapseContentProps} from "../types"

/**
 * Renders annotation input fields using the new AnnotationFieldRenderer
 * which provides immediate onChange updates (no debouncing issues)
 */
const AnnotateCollapseContent = ({metadata, annSlug, onChange}: AnnotateCollapseContentProps) => {
    return (
        <AnnotationFieldRenderer metadata={metadata as any} annSlug={annSlug} onChange={onChange} />
    )
}

export default memo(AnnotateCollapseContent)
