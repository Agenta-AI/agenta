import {Badge} from "@agenta/ui/ui"

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
        return <Badge variant="warning">Loading...</Badge>
    }
    if (query.isError) {
        return <Badge variant="error">Error</Badge>
    }
    return <Badge variant="success">Ready</Badge>
}
