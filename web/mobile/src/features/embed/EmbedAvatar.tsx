import {getInitials} from "@agenta/ui/components/presentational"

import type {EmbedAppearance} from "./embedConfig"

/** The agent's avatar from the embed's appearance, or the name's initials on the accent. */
export const EmbedAvatar = ({
    appearance,
    large = false,
}: {
    appearance: EmbedAppearance
    /** 40 px, for the greeting; 24 px otherwise. */
    large?: boolean
}) =>
    appearance.avatarUrl ? (
        <img
            src={appearance.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className={`${large ? "size-10 rounded-lg" : "size-6 rounded-md"} shrink-0 object-cover`}
        />
    ) : (
        <span
            aria-hidden
            className={`${large ? "size-10 rounded-lg text-title" : "size-6 rounded-md text-caption"} flex shrink-0 items-center justify-center bg-secondary text-muted-foreground`}
        >
            {getInitials(appearance.name)}
        </span>
    )
