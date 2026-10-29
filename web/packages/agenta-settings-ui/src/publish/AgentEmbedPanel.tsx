import {Alert, Button, EmptyState, LoadingButton, SkeletonBlock} from "@agenta/ui/ui"
import {CaretRight, ChatCircleText} from "@phosphor-icons/react"
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query"

import type {EmbedViewProps} from "../channels/useChannelPanel"

import {createEmbed, listAgentEmbeds, parseOrigins, type EmbedClient} from "./embedApi"
import {EmbedSettingsForm} from "./EmbedSettingsForm"

export interface AgentEmbedPanelProps extends EmbedViewProps {
    /** The host's generated channels client (`getChannelsClient()`). */
    client: EmbedClient
    projectId: string
    agentId: string
    agentName?: string
    /** The widget page for a public embed id, for the preview. */
    widgetUrl: (embedId: string) => string
}

/** Publish > Embed: the agent's embeds and "Create embed", or one embed's settings. */
export const AgentEmbedPanel = (props: AgentEmbedPanelProps) => {
    const {client, projectId, agentId, agentName, connectionId, onOpen} = props
    const queryClient = useQueryClient()
    const scope = {queryParams: {project_id: projectId}}
    const queryKey = ["channels", "embeds", projectId, agentId]
    const embeds = useQuery({
        queryKey,
        queryFn: () => listAgentEmbeds(client, scope, agentId),
        refetchOnWindowFocus: false,
    })

    // A new embed is named after the agent and open to any site; the owner edits it in its settings.
    const create = useMutation({
        mutationFn: () => createEmbed(client, scope, agentId, agentName ?? ""),
        onSuccess: async (id) => {
            await queryClient.invalidateQueries({queryKey})
            onOpen(id)
        },
    })

    if (embeds.isPending) {
        return (
            <div className="flex flex-col gap-2.5" data-testid="agent-embed-loading">
                <SkeletonBlock active className="h-[52px] w-full rounded-lg" />
                <SkeletonBlock active className="h-[52px] w-full rounded-lg" />
            </div>
        )
    }
    // A failed refresh keeps the cached list, so an open form keeps its edits.
    if (!embeds.data) {
        return (
            <div className="flex flex-col items-start gap-2.5">
                <Alert
                    type="error"
                    showIcon
                    message={embeds.error?.message ?? "Could not load the embeds."}
                    className="w-full"
                />
                <Button variant="outline" size="sm" onClick={() => void embeds.refetch()}>
                    Try again
                </Button>
            </div>
        )
    }

    if (connectionId) {
        const embed = embeds.data.find((candidate) => candidate.id === connectionId)
        if (!embed) {
            return <Alert type="error" showIcon message="This embed no longer exists." />
        }
        return <EmbedSettingsForm key={embed.id} {...props} embed={embed} queryKey={queryKey} />
    }

    const createButton = (
        <LoadingButton
            loading={create.isPending}
            onClick={() => create.mutate()}
            data-testid="agent-embed-create"
        >
            Create embed
        </LoadingButton>
    )
    const createError = create.error ? (
        <Alert type="error" showIcon message={create.error.message} />
    ) : null

    if (!embeds.data.length) {
        return (
            <div className="flex min-w-0 flex-col gap-3" data-testid="agent-embed-panel">
                <EmptyState
                    image={<ChatCircleText size={24} />}
                    title="No embeds yet"
                    description="Add a chat with this agent to your website."
                >
                    {createButton}
                </EmptyState>
                {createError}
            </div>
        )
    }

    return (
        <div className="flex min-w-0 flex-col gap-3" data-testid="agent-embed-panel">
            <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-muted-foreground">
                    Add a chat with this agent to your website.
                </span>
                {createButton}
            </div>
            {createError}
            <div className="flex flex-col gap-2">
                {embeds.data.map((embed) => (
                    <Button
                        key={embed.id}
                        variant="outline"
                        onClick={() => onOpen(embed.id)}
                        className="h-auto w-full justify-start gap-3 rounded-lg py-2.5 pl-3 pr-2.5 text-left"
                        data-testid={`agent-embed-${embed.id}`}
                    >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <span className="truncate text-sm font-medium text-foreground">
                                {embed.name || "Embed"}
                            </span>
                            <span className="truncate text-[12.5px] text-muted-foreground">
                                {embed.restricted
                                    ? parseOrigins(embed.origins).origins.join(", ")
                                    : "Any website"}
                            </span>
                        </span>
                        <CaretRight size={12} className="flex-none text-muted-foreground" />
                    </Button>
                ))}
            </div>
        </div>
    )
}
