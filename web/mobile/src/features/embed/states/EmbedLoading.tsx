import {SkeletonBlock} from "@agenta/ui/ui"

/** The transcript's geometry while the visitor's conversation loads. */
export const EmbedLoading = () => (
    <div className="flex flex-col gap-4 p-4" aria-busy="true" aria-label="Loading the chat">
        <SkeletonBlock className="h-10 w-3/4 self-start rounded-md" />
        <SkeletonBlock className="h-8 w-1/2 self-end rounded-md" />
        <SkeletonBlock className="h-16 w-4/5 self-start rounded-md" />
    </div>
)
