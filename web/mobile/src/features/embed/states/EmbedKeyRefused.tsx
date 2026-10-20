import {Key} from "@phosphor-icons/react"

/** The host page passed a visitor key that breaks the key rule; the widget does not use it. */
export const EmbedKeyRefused = () => (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Key size={28} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">This chat could not start.</p>
        <p className="text-xs text-muted-foreground">
            The website sent a visitor key that is not valid. Contact the owner of this website.
        </p>
    </div>
)
