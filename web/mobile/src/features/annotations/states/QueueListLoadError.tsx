import {LoadError} from "@agenta/ui/components/presentational"

/** The list request failed. Rows that were already loaded stay on screen instead of this. */
export const QueueListLoadError = ({onRetry}: {onRetry: () => void}) => (
    <LoadError framed title="Could not load annotation queues" onRetry={onRetry} />
)
