import {getInitials} from "@agenta/ui/components/presentational"

import type {EmbedAppearance} from "./embedConfig"

/** The agent's avatar from the embed's appearance, or the name's initials on the accent. */
export const EmbedAvatar = ({
    appearance,
    large = false,
}: {
    appearance: EmbedAppearance
    /** 44 px, for the greeting; 28 px otherwise. */
    large?: boolean
}) =>
    appearance.avatarUrl ? (
        <img
            src={appearance.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className={`${large ? "size-11" : "size-7"} shrink-0 rounded-full object-cover`}
        />
    ) : (
        <span
            aria-hidden
            className={`${large ? "size-11 text-base" : "size-7 text-[11px]"} flex shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground`}
        >
            {getInitials(appearance.name)}
        </span>
    )
