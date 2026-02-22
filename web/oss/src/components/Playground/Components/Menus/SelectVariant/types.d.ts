import {TreeSelectProps} from "antd"

export interface SelectVariantProps extends TreeSelectProps {
    showAsCompare?: boolean
    showCreateNew?: boolean
    showLatestTag?: boolean
    /**
     * Selection mode:
     * - `"scoped"` (default): 2-level (Variant → Revision), scoped to the current app
     * - `"browse"`: 3-level (Workflow → Variant → Revision), shows all workflows (apps + evaluators)
     */
    mode?: "scoped" | "browse"
    /**
     * Custom browse adapter for 3-level mode.
     * When provided, overrides the default browseAdapter.
     * Use this to customize workflow rendering (e.g., colored evaluator tags, filtering).
     */
    customBrowseAdapter?: import("@agenta/entity-ui/selection").EntitySelectionAdapter<
        import("@agenta/entity-ui/selection").WorkflowRevisionSelectionResult
    >
}

export interface TreeSelectItemRendererProps {
    isOpen: boolean
    menu: any
    close: () => void
    showAsCompare?: boolean
    showCreateNew?: boolean
    searchTerm: string
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>
}
