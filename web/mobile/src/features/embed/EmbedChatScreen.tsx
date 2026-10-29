import type {CSSProperties} from "react"

import Head from "next/head"

import {EmbedChat} from "./EmbedChat"
import type {EmbedConfig} from "./embedConfig"
import {EmbedKeyRefused} from "./states/EmbedKeyRefused"
import {EmbedLoading} from "./states/EmbedLoading"
import {EmbedUnavailable} from "./states/EmbedUnavailable"
import {useEmbedTheme} from "./useEmbedTheme"
import {useEmbedVisitor} from "./useEmbedVisitor"

const NO_ORIGINS: string[] = []

/** The widget page: the host handshake first, then the visitor's chat. */
export const EmbedChatScreen = ({
    embedId,
    config,
}: {
    embedId: string
    config: EmbedConfig | null
}) => {
    const appearance = config?.appearance
    useEmbedTheme(appearance?.theme ?? "system")
    const {visitor, host} = useEmbedVisitor({
        embedId,
        allowedOrigins: config?.allowedOrigins ?? NO_ORIGINS,
    })

    // The accent recolors the primary role: buttons, links and the user's bubble.
    const accentStyle = appearance?.accent
        ? ({
              "--primary": appearance.accent,
              "--ag-colorPrimary": appearance.accent,
          } as CSSProperties)
        : undefined

    let body
    if (!config) body = <EmbedUnavailable />
    else if (visitor.status === "waiting") body = <EmbedLoading />
    else if (visitor.status === "refused") body = <EmbedKeyRefused />
    else
        body = (
            <EmbedChat
                embedId={embedId}
                appearance={config.appearance}
                visitorKey={visitor.visitorKey}
                host={host}
            />
        )

    return (
        <>
            <Head>
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>{appearance?.name ?? "Chat"}</title>
            </Head>
            <div className="flex h-dvh flex-col overflow-hidden bg-background" style={accentStyle}>
                {body}
            </div>
        </>
    )
}
