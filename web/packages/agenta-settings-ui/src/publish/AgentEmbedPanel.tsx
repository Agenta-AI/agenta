import {useId, useState} from "react"

import {Alert, Button, Input, LoadingButton, SkeletonBlock} from "@agenta/ui/ui"
import {CaretRight} from "@phosphor-icons/react"
import {useMutation, useQuery, useQueryClient} from "@tanstack/react-query"

import type {EmbedViewProps} from "../channels/useChannelPanel"

import {
    createEmbed,
    listAgentEmbeds,
    originsError,
    parseOrigins,
    type EmbedClient,
} from "./embedApi"
import {EmbedDomainsField, type EmbedDomains} from "./EmbedDomainsField"
import {EmbedSettingsForm, FieldLabel} from "./EmbedSettingsForm"

export interface AgentEmbedPanelProps extends EmbedViewProps {
    /** The host's generated channels client (`getChannelsClient()`). */
    client: EmbedClient
    projectId: string
    agentId: string
    agentName?: string
    /** The widget page for a public embed id, for the preview. */
    widgetUrl: (embedId: string) => string
}

/** Publish > Embed: the agent's embeds and a form for a new one, or one embed's settings. */
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

    const nameId = useId()
    const originsId = useId()
    const [name, setName] = useState(agentName ?? "")
    const [domains, setDomains] = useState<EmbedDomains>({restricted: false, origins: ""})
    const [domainsError, setDomainsError] = useState<string | null>(null)
    const create = useMutation({
        mutationFn: () => createEmbed(client, scope, agentId, {name, ...domains}),
        onSuccess: async (id) => {
            await queryClient.invalidateQueries({queryKey})
            setDomains({restricted: false, origins: ""})
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

    const submit = () => {
        const error = originsError(domains)
        setDomainsError(error)
        if (!error) create.mutate()
    }

    return (
        <div className="flex min-w-0 flex-col gap-[18px]" data-testid="agent-embed-panel">
            {embeds.data.length ? (
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
                                {embed.restricted ? (
                                    <span className="truncate text-[12.5px] text-muted-foreground">
                                        {parseOrigins(embed.origins).origins.join(", ")}
                                    </span>
                                ) : null}
                            </span>
                            <CaretRight size={12} className="flex-none text-muted-foreground" />
                        </Button>
                    ))}
                </div>
            ) : (
                <span className="text-[13px] text-muted-foreground">
                    Add a chat with this agent to your website.
                </span>
            )}

            <div className="flex flex-col gap-3 rounded-lg border border-solid border-border p-3">
                <span className="text-sm font-medium text-foreground">New embed</span>
                <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor={nameId}>Name</FieldLabel>
                    <Input id={nameId} value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <EmbedDomainsField
                    id={originsId}
                    value={domains}
                    onChange={(patch) => setDomains((d) => ({...d, ...patch}))}
                />
                {domainsError || create.error ? (
                    <Alert type="error" showIcon message={domainsError ?? create.error?.message} />
                ) : null}
                <LoadingButton
                    className="self-start"
                    loading={create.isPending}
                    onClick={submit}
                    data-testid="agent-embed-create"
                >
                    Create
                </LoadingButton>
            </div>
        </div>
    )
}
