import {Tag} from "antd"

interface QueryState {
    isPending: boolean
    isError: boolean
}

export interface EntityStatusTagProps {
    query: QueryState
}

/**
 * Renders a status tag based on the query state of an entity.
 * Shows Loading/Error/Ready states with appropriate colors.
 */
export function EntityStatusTag({query}: EntityStatusTagProps) {
    if (query.isPending) {
        return <Tag color="warning">Loading...</Tag>
    }
    if (query.isError) {
        return <Tag color="error">Error</Tag>
    }
    return <Tag color="success">Ready</Tag>
}
