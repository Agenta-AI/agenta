import {ChatDotsIcon, NoteIcon} from "@phosphor-icons/react"

/**
 * The icon in front of an app's name: a chat bubble for a chat app, a note for every other
 * type. Shared by the Prompts list and the archived apps list so the two read the same.
 */
export const AppTypeIcon = ({
    appType,
    size = 18,
}: {
    appType: string | null | undefined
    size?: number
}) => {
    const Icon = appType === "chat" ? ChatDotsIcon : NoteIcon
    return <Icon size={size} className="shrink-0 text-muted-foreground" />
}
