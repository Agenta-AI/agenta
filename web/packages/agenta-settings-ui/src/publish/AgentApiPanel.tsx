import {useId, useMemo, useState} from "react"

import {createApiKey} from "@agenta/settings"
import {message} from "@agenta/ui/app-message"
import {CopyButton} from "@agenta/ui/components/presentational"
import {Input, LoadingButton, Segmented, Switch} from "@agenta/ui/ui"
import {ArrowSquareOut} from "@phosphor-icons/react"

import {CodeBlock} from "../channels/CodeBlock"

import {AGENT_INVOKE_DOCS_URL, agentInvokeUrl} from "./snippets/request"
import {buildAgentSnippets, type AgentSnippetLang} from "./snippets/snippets"

export interface AgentApiPanelProps {
    agentId: string
    projectId: string
    /** The Agenta origin, without `/api`. */
    host: string
    /** Needed to create an API key for this project. */
    workspaceId?: string | null
}

const LANGS: {value: AgentSnippetLang; label: string}[] = [
    {value: "python", label: "Python"},
    {value: "typescript", label: "TypeScript"},
    {value: "bash", label: "cURL"},
]

const SNIPPET_FILE: Record<AgentSnippetLang, string> = {
    python: "request.py",
    typescript: "request.ts",
    bash: "request.sh",
}

const FieldLabel = ({children, htmlFor}: {children: React.ReactNode; htmlFor?: string}) => (
    <label htmlFor={htmlFor} className="text-[13px] font-semibold text-foreground">
        {children}
    </label>
)

/**
 * Publish > API: how to call the agent over HTTP. The endpoint, an API key, then one snippet
 * per language that streams by default and switches to a single JSON response. The snippets
 * follow the "Invoke an agent" docs and reference only the workflow, so they always run the
 * default variant's latest revision.
 */
export const AgentApiPanel = ({agentId, projectId, host, workspaceId}: AgentApiPanelProps) => {
    const keyInputId = useId()
    const [lang, setLang] = useState<AgentSnippetLang>("python")
    const [stream, setStream] = useState(true)
    const [apiKeyValue, setApiKeyValue] = useState("")
    const [creating, setCreating] = useState(false)
    const apiKey = apiKeyValue || "YOUR_API_KEY"

    const endpoint = agentInvokeUrl({host, projectId})
    const code = useMemo(() => {
        const [streaming, json] = buildAgentSnippets(lang, {host, projectId, agentId, apiKey})
        return (stream ? streaming : json).code
    }, [lang, stream, host, projectId, agentId, apiKey])

    const create = async () => {
        if (!workspaceId) {
            message.error("Could not determine project/workspace. Please try refreshing.")
            return
        }
        setCreating(true)
        try {
            setApiKeyValue(await createApiKey(workspaceId, projectId))
            message.success("Successfully generated API Key")
        } catch {
            message.error("Unable to generate API Key")
        } finally {
            setCreating(false)
        }
    }

    return (
        <div className="flex min-w-0 flex-col gap-[18px]" data-testid="agent-api-panel">
            <div className="flex flex-col gap-1.5">
                <FieldLabel>Endpoint</FieldLabel>
                <div className="flex min-w-0 items-center gap-2 rounded-lg border border-solid border-border bg-muted py-1 pl-2 pr-1">
                    <span className="shrink-0 rounded bg-background px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">
                        POST
                    </span>
                    <span
                        className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground"
                        title={endpoint}
                        data-testid="agent-api-endpoint"
                    >
                        {endpoint}
                    </span>
                    <CopyButton buttonText={null} text={endpoint} icon={true} />
                </div>
                <span className="text-[12.5px] text-muted-foreground">
                    Authenticate with a project API key.
                </span>
            </div>

            <div className="flex flex-col gap-1.5">
                <FieldLabel htmlFor={keyInputId}>API key</FieldLabel>
                <div className="flex min-w-0 items-center gap-2">
                    <Input
                        id={keyInputId}
                        className="min-w-0 flex-1"
                        placeholder="Enter existing API key"
                        value={apiKeyValue}
                        onChange={(event) => setApiKeyValue(event.target.value)}
                    />
                    <LoadingButton variant="outline" loading={creating} onClick={create}>
                        Create API key
                    </LoadingButton>
                </div>
            </div>

            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <Segmented
                        size="sm"
                        options={LANGS}
                        value={lang}
                        onChange={(value) => setLang(value as AgentSnippetLang)}
                        data-testid="agent-api-lang"
                    />
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                        <Switch
                            size="sm"
                            checked={stream}
                            onCheckedChange={setStream}
                            data-testid="agent-api-stream"
                        />
                        Streaming
                    </label>
                </div>
                <CodeBlock
                    label={SNIPPET_FILE[lang]}
                    code={code}
                    maxHeightClass="max-h-[420px]"
                    data-testid="agent-api-snippet"
                />
            </div>

            <a
                href={AGENT_INVOKE_DOCS_URL}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-foreground underline-offset-2 hover:underline"
            >
                Read the docs
                <ArrowSquareOut size={14} />
            </a>
        </div>
    )
}
