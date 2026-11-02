import {Button} from "@agenta/ui/ui"

/** The queue list failed to load. The reason goes to the console, never to the screen. */
export const AddToQueuePickerError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex flex-col items-center gap-2 px-3 py-6 text-center">
        <p className="m-0 text-xs text-muted-foreground">Couldn&apos;t load the queues.</p>
        <Button size="sm" variant="outline" onClick={onRetry}>
            Try again
        </Button>
    </div>
)
