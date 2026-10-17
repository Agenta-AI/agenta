import {Robot} from "@phosphor-icons/react"

import type {EmbedAppearance} from "./embedConfig"

/** The agent's avatar from the embed's appearance, or a neutral glyph. */
export const EmbedAvatar = ({appearance}: {appearance: EmbedAppearance}) =>
    appearance.avatarUrl ? (
        <img
            src={appearance.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-7 shrink-0 rounded-full object-cover"
        />
    ) : (
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Robot size={16} />
        </span>
    )
