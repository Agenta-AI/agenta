import type {GetServerSideProps} from "next"

import {EmbedChatScreen} from "@/features/embed/EmbedChatScreen"
import {
    fetchEmbedConfig,
    frameAncestorsPolicy,
    type EmbedConfig,
} from "@/features/embed/embedConfig"

interface EmbedPageProps {
    embedId: string
    config: EmbedConfig | null
}

export const getServerSideProps: GetServerSideProps<EmbedPageProps> = async ({params, res}) => {
    const embedId = typeof params?.embedId === "string" ? params.embedId : ""
    const config = await fetchEmbedConfig(
        embedId,
        process.env.AGENTA_API_INTERNAL_URL || process.env.AGENTA_API_URL,
    )
    // The check on where the widget may run: the browser refuses to frame it anywhere else.
    res.setHeader(
        "Content-Security-Policy",
        frameAncestorsPolicy(config, process.env.AGENTA_WEB_URL),
    )
    res.setHeader("Cache-Control", "no-store")
    return {props: {embedId, config}}
}

export default function EmbedPage({embedId, config}: EmbedPageProps) {
    return <EmbedChatScreen embedId={embedId} config={config} />
}
