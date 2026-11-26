import {LoadError} from "@agenta/ui/components/presentational"

/**
 * The app, its latest revision, or the selected revision failed to load (an app with no
 * revision lands here too, as in the old playground). Try again fetches the failed requests
 * again; it does not reload the page, so local drafts survive.
 */
export const PlaygroundLoadError = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex h-full items-center justify-center px-4">
        <LoadError
            title="Something went wrong"
            description="Playground is unable to communicate with the service"
            onRetry={onRetry}
        />
    </div>
)
