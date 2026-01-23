import {type FC, type ReactNode, createElement} from "react"

import {RightOutlined, DownOutlined} from "@ant-design/icons"
import clsx from "clsx"

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
        {createElement(folded ? RightOutlined : DownOutlined, {
            className: "text-[10px] mr-1 cursor-pointer",
            onClick: onToggle,
        })}
        {children}
        {extra && <span className="ml-1 flex items-center">{extra}</span>}
    </TreeRow>
)

export default NodeHeader
