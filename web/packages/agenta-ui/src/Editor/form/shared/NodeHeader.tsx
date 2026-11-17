import {type FC, type ReactNode} from "react"

import clsx from "clsx"

import {CollapseCaret} from "../../../components/ui/collapse-caret"
import styles from "../FormView.module.css"

import TreeRow from "./TreeRow"

interface NodeHeaderProps {
    depth: number
    folded: boolean
    onToggle: () => void
    className?: string
    children: ReactNode // the label / editable key element
    extra?: ReactNode // any trailing buttons (e.g., add item)
}

/**
 * Reusable header for Array/Object nodes.
 * Renders caret, label, and optional trailing actions.
 * Tailwind handles typography; caller decides exact label node.
 */
const NodeHeader: FC<NodeHeaderProps> = ({depth, folded, onToggle, children, extra, className}) => (
    <TreeRow depth={depth} className={clsx(styles["node-header"], className)}>
        <button
            type="button"
            aria-expanded={!folded}
            aria-label={folded ? "Expand" : "Collapse"}
            onClick={onToggle}
            className="mr-1 inline-flex cursor-pointer items-center rounded-sm border-0 bg-transparent p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus-ring"
        >
            <CollapseCaret open={!folded} size={12} />
        </button>
        {children}
        {extra && <span className="ml-1 flex items-center">{extra}</span>}
    </TreeRow>
)

export default NodeHeader
