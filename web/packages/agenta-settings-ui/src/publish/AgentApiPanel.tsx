import {useMemo, useState} from "react"

import {createApiKey} from "@agenta/settings"
import {message} from "@agenta/ui/app-message"
import {CopyButton} from "@agenta/ui/components/presentational"
import {Input, LoadingButton, Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/ui/ui"

import {AGENT_INVOKE_DOCS_URL} from "./snippets/request"
import {buildAgentSnippets, type AgentSnippetLang} from "./snippets/snippets"

export interface ApiKeyFieldProps {
    value: string
    onChange: (value: string) => void
}

export interface AgentApiPanelProps {
    agentId: string
    projectId: string
    /** The Agenta origin, without `/api`. */
    host: string
    /** Needed by the built-in API key field to create a key. */
    workspaceId?: string | null
}

const LANGS: {key: AgentSnippetLang; label: string}[] = [
    {key: "python", label: "Python"},
    {key: "typescript", label: "TypeScript"},
    {key: "bash", label: "cURL"},
]

const PlainCode = ({code}: {code: string}) => (
    <pre className="m-0 overflow-x-auto whitespace-pre rounded-lg border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-3 font-mono text-xs leading-relaxed text-colorText">
        {code}
    </pre>
)

/** The classic "Use API" key field: paste a key, or generate one for this project. */
const ApiKeyField = ({
    value,
    onChange,
    workspaceId,
    projectId,
}: ApiKeyFieldProps & {workspaceId?: string | null; projectId: string}) => {
    const [loading, setLoading] = useState(false)
    const generate = async () => {
        if (!workspaceId) {
            message.error("Could not determine project/workspace. Please try refreshing.")
            return
        }
        setLoading(true)
        try {
            onChange(await createApiKey(workspaceId, projectId))
            message.success("Successfully generated API Key")
        } catch {
            message.error("Unable to generate API Key")
        } finally {
            setLoading(false)
        }
    }
    return (
        <div className="flex flex-col gap-1">
            <span className="text-sm font-medium text-colorText">Create or enter your API key</span>
            <div className="flex flex-wrap items-center gap-2">
                <Input
                    className="w-full max-w-[300px]"
                    placeholder="Enter existing API key"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                />
                <LoadingButton variant="outline" loading={loading} onClick={generate}>
                    Generate API Key
                </LoadingButton>
            </div>
        </div>
    )
}

/**
 * Publish > API: how to call the agent over HTTP. An API key field, then Python / TypeScript /
 * cURL tabs, each with a streaming and a JSON snippet that follow the "Invoke an agent" docs.
 * The snippets reference only the workflow, so they always run the default variant's latest
 * revision.
 */
export const AgentApiPanel = ({agentId, projectId, host, workspaceId}: AgentApiPanelProps) => {
    const [lang, setLang] = useState<AgentSnippetLang>("python")
    const [apiKeyValue, setApiKeyValue] = useState("")
    const apiKey = apiKeyValue || "YOUR_API_KEY"

    const snippets = useMemo(
        () => buildAgentSnippets(lang, {host, projectId, agentId, apiKey}),
        [lang, host, projectId, agentId, apiKey],
    )

    const field = {value: apiKeyValue, onChange: setApiKeyValue}

    return (
        <div className="flex flex-col gap-4" data-testid="agent-api-panel">
            <div className="flex flex-col gap-3">
                <ApiKeyField {...field} workspaceId={workspaceId} projectId={projectId} />
                <a
                    href={AGENT_INVOKE_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm text-colorPrimary"
                >
                    Invoke an agent
                </a>
            </div>
            <Tabs value={lang} onValueChange={(value) => setLang(value as AgentSnippetLang)}>
                <TabsList>
                    {LANGS.map((item) => (
                        <TabsTrigger key={item.key} value={item.key}>
                            {item.label}
                        </TabsTrigger>
                    ))}
                </TabsList>
                <TabsContent value={lang} className="flex flex-col gap-6 pt-2">
                    {snippets.map((snippet) => (
                        <div
                            key={snippet.key}
                            className="flex min-w-0 flex-col gap-2"
                            data-testid={`agent-api-snippet-${snippet.key}`}
                        >
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-colorText">
                                    {snippet.title}
                                </span>
                                <CopyButton buttonText={null} text={snippet.code} icon={true} />
                            </div>
                            <PlainCode code={snippet.code} />
                        </div>
                    ))}
                </TabsContent>
            </Tabs>
        </div>
    )
}
