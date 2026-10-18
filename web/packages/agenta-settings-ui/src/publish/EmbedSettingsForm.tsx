import {useId, useState} from "react"

import {CopyButton} from "@agenta/ui/components/presentational"
import {Alert, Button, Input, LoadingButton, Segmented, Textarea} from "@agenta/ui/ui"
import {useMutation, useQuery, useQueryClient, type QueryKey} from "@tanstack/react-query"

import {CodeBlock} from "../channels/CodeBlock"
import {PanelFooter} from "../channels/PanelFooter"

import type {AgentEmbedPanelProps} from "./AgentEmbedPanel"
import {
    MAX_STARTERS,
    appearanceError,
    archiveEmbed,
    embedAssistantPrompt,
    fetchEmbedSnippet,
    originsError,
    saveEmbed,
    type Embed,
    type EmbedSettings,
    type EmbedTheme,
} from "./embedApi"
import {EmbedDomainsField} from "./EmbedDomainsField"

export const FieldLabel = ({children, htmlFor}: {children: React.ReactNode; htmlFor?: string}) => (
    <label htmlFor={htmlFor} className="text-[13px] font-semibold text-foreground">
        {children}
    </label>
)

const THEMES: {value: EmbedTheme; label: string}[] = [
    {value: "system", label: "System"},
    {value: "light", label: "Light"},
    {value: "dark", label: "Dark"},
]

const padStarters = (starters: string[]) =>
    Array.from({length: MAX_STARTERS}, (_, index) => starters[index] ?? "")

/** One embed: its name, domains and appearance, the snippet, a live preview, and archive. */
export const EmbedSettingsForm = ({
    client,
    projectId,
    embed,
    queryKey,
    widgetUrl,
    onBack,
}: AgentEmbedPanelProps & {embed: Embed; queryKey: QueryKey}) => {
    const queryClient = useQueryClient()
    const scope = {queryParams: {project_id: projectId}}
    const ids = {
        name: useId(),
        origins: useId(),
        avatar: useId(),
        greeting: useId(),
        accent: useId(),
    }

    const initial: EmbedSettings = {
        ...embed,
        appearance: {...embed.appearance, starters: padStarters(embed.appearance.starters)},
    }
    const [draft, setDraft] = useState<EmbedSettings>(initial)
    const [saved, setSaved] = useState(initial)
    const [formError, setFormError] = useState<string | null>(null)
    // Bumped on each save, so the preview reloads with the new settings.
    const [previewKey, setPreviewKey] = useState(0)
    const [confirming, setConfirming] = useState(false)
    const dirty = JSON.stringify(draft) !== JSON.stringify(saved)

    const snippet = useQuery({
        queryKey: ["channels", "embed-snippet", projectId, embed.id],
        queryFn: () => fetchEmbedSnippet(client, scope, embed.id),
        refetchOnWindowFocus: false,
    })
    const save = useMutation({
        mutationFn: (settings: EmbedSettings) => saveEmbed(client, scope, settings),
        onSuccess: async (_, settings) => {
            setSaved(settings)
            setPreviewKey((key) => key + 1)
            await queryClient.invalidateQueries({queryKey})
        },
    })
    const archive = useMutation({
        mutationFn: () => archiveEmbed(client, scope, embed.id),
        onSuccess: async () => {
            await queryClient.invalidateQueries({queryKey})
            onBack()
        },
    })

    const set = (patch: Partial<EmbedSettings>) => setDraft((d) => ({...d, ...patch}))
    const setAppearance = (patch: Partial<EmbedSettings["appearance"]>) =>
        setDraft((d) => ({...d, appearance: {...d.appearance, ...patch}}))

    const submit = () => {
        const error = originsError(draft) ?? appearanceError(draft.appearance)
        setFormError(error)
        if (!error) save.mutate(draft)
    }
    const error = formError ?? save.error?.message ?? archive.error?.message ?? null

    return (
        <div className="flex min-w-0 flex-col gap-[18px]" data-testid="agent-embed-settings">
            <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor={ids.name}>Name</FieldLabel>
                <Input
                    id={ids.name}
                    value={draft.name}
                    onChange={(e) => set({name: e.target.value})}
                    data-testid="agent-embed-name"
                />
            </div>
            <EmbedDomainsField id={ids.origins} value={draft} onChange={set} />
            <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor={ids.avatar}>Avatar URL</FieldLabel>
                <Input
                    id={ids.avatar}
                    placeholder="https://"
                    value={draft.appearance.avatarUrl}
                    onChange={(e) => setAppearance({avatarUrl: e.target.value})}
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor={ids.greeting}>Greeting</FieldLabel>
                <Textarea
                    id={ids.greeting}
                    rows={2}
                    value={draft.appearance.greeting}
                    onChange={(e) => setAppearance({greeting: e.target.value})}
                    data-testid="agent-embed-greeting"
                />
            </div>
            <div className="flex flex-col gap-1.5">
                <FieldLabel>Starter prompts</FieldLabel>
                {draft.appearance.starters.map((starter, index) => (
                    <Input
                        key={index}
                        aria-label={`Starter prompt ${index + 1}`}
                        value={starter}
                        onChange={(e) =>
                            setAppearance({
                                starters: draft.appearance.starters.map((s, i) =>
                                    i === index ? e.target.value : s,
                                ),
                            })
                        }
                        data-testid={`agent-embed-starter-${index}`}
                    />
                ))}
            </div>
            <div className="flex flex-wrap items-end gap-4">
                <div className="flex flex-col gap-1.5">
                    <FieldLabel>Theme</FieldLabel>
                    <Segmented
                        size="sm"
                        options={THEMES}
                        value={draft.appearance.theme}
                        onChange={(value) => setAppearance({theme: value as EmbedTheme})}
                        data-testid="agent-embed-theme"
                    />
                </div>
                <div className="flex flex-col gap-1.5">
                    <FieldLabel htmlFor={ids.accent}>Accent</FieldLabel>
                    <Input
                        id={ids.accent}
                        className="w-32"
                        placeholder="#2563eb"
                        value={draft.appearance.accent}
                        onChange={(e) => setAppearance({accent: e.target.value})}
                        data-testid="agent-embed-accent"
                    />
                </div>
            </div>

            {error ? <Alert type="error" showIcon message={error} /> : null}
            <LoadingButton
                className="self-start"
                disabled={!dirty}
                loading={save.isPending}
                onClick={submit}
                data-testid="agent-embed-save"
            >
                Save changes
            </LoadingButton>

            <div className="flex flex-col gap-1.5">
                <FieldLabel>Snippet</FieldLabel>
                {snippet.data ? (
                    <CodeBlock
                        label="embed.html"
                        code={snippet.data}
                        maxHeightClass="max-h-[320px]"
                        actions={
                            <CopyButton
                                text={embedAssistantPrompt(snippet.data)}
                                buttonText="Copy prompt"
                                icon
                                variant="ghost"
                                size="xs"
                                successMessage="Prompt copied"
                                data-testid="agent-embed-copy-prompt"
                            />
                        }
                        data-testid="agent-embed-snippet"
                    />
                ) : snippet.isError ? (
                    <Alert type="error" showIcon message={snippet.error.message} />
                ) : (
                    <span className="text-[12.5px] text-muted-foreground">Loading…</span>
                )}
                <span className="text-[12.5px] text-muted-foreground">
                    Paste it into a page on your website.
                </span>
            </div>

            <div className="flex flex-col gap-1.5">
                <FieldLabel>Preview</FieldLabel>
                <iframe
                    key={previewKey}
                    title="Preview"
                    src={widgetUrl(embed.embedId)}
                    className="h-[520px] w-full rounded-lg border border-solid border-border bg-background"
                    data-testid="agent-embed-preview"
                />
            </div>

            <PanelFooter>
                {confirming ? (
                    <div className="flex w-full flex-col gap-2.5">
                        <span className="text-[13px] text-foreground">
                            Archive this embed? The chat stops working on every website. Past
                            conversations stay in Agenta.
                        </span>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                disabled={archive.isPending}
                                onClick={() => setConfirming(false)}
                            >
                                Cancel
                            </Button>
                            <LoadingButton
                                variant="destructive"
                                loading={archive.isPending}
                                onClick={() => archive.mutate()}
                                data-testid="agent-embed-archive-confirm"
                            >
                                Archive
                            </LoadingButton>
                        </div>
                    </div>
                ) : (
                    <div className="flex w-full justify-end">
                        <Button
                            variant="destructive"
                            onClick={() => setConfirming(true)}
                            data-testid="agent-embed-archive"
                        >
                            Archive
                        </Button>
                    </div>
                )}
            </PanelFooter>
        </div>
    )
}
