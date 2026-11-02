import {ChatCircleSlash} from "@phosphor-icons/react"

/** The embed is missing, archived or refuses this visitor: there is nothing to talk to. */
export const EmbedUnavailable = () => (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <ChatCircleSlash size={28} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">This chat is not available.</p>
        <p className="text-xs text-muted-foreground">Contact the owner of this website.</p>
    </div>
)
