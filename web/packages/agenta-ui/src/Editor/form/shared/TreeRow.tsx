import {type FC, type ReactNode} from "react"

import clsx from "clsx"

import styles from "../FormView.module.css"

/**
 * Generic wrapper for each row in the JSON tree.
 * Handles indentation (depth) and shared styling.
 * Tailwind is used for flex layout; the dynamic indentation remains inline
 * but it is centralised here so node components no longer contain inline styles.
 */
export interface TreeRowProps {
    depth: number
    className?: string
    children: ReactNode
}

const INDENT_PX = 10 // matches previous implementation

const TreeRow: FC<TreeRowProps> = ({depth, className, children}) => (
    <div
        style={{paddingLeft: depth ? depth * INDENT_PX : 0, marginLeft: depth ? 4 : 0}}
        className={clsx(styles["tree-row"], "flex items-center mb-0.5", className)}
    >
        {children}
    </div>
)

export default TreeRow
