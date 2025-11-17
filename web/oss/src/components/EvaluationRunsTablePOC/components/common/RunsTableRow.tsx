import type {HTMLAttributes} from "react"
import {forwardRef, memo} from "react"

import {RunRowDataProvider} from "../../context/RunRowDataContext"
import type {EvaluationRunTableRow} from "../../types"

import VisibilityAwareRow from "./VisibilityAwareRow"

const BaseRunsTableRow = forwardRef<
    HTMLDivElement,
    HTMLAttributes<HTMLDivElement> & {record?: EvaluationRunTableRow}
>(({record, children, ...rest}, ref) => {
    if (!record) {
        return (
            <VisibilityAwareRow {...rest} ref={ref}>
                {children}
            </VisibilityAwareRow>
        )
    }

    return (
        <VisibilityAwareRow {...rest} ref={ref}>
            <RunRowDataProvider record={record}>{children}</RunRowDataProvider>
        </VisibilityAwareRow>
    )
})

BaseRunsTableRow.displayName = "RunsTableRow"

const shallowEqual = (a?: Record<string, unknown>, b?: Record<string, unknown>) => {
    if (a === b) return true
    if (!a || !b) return false
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    return keysA.every((key) => (a as any)[key] === (b as any)[key])
}

const RunsTableRow = memo(BaseRunsTableRow, (prev, next) => {
    if (prev.record?.key !== next.record?.key) return false
    if (prev.className !== next.className) return false
    if (!shallowEqual(prev.style as any, next.style as any)) return false
    return true
})

RunsTableRow.displayName = "MemoizedRunsTableRow"

export default RunsTableRow
