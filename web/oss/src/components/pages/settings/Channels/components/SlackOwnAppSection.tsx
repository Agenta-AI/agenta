import {useState} from "react"

import {CopyButton} from "@agenta/ui/components/presentational"
import type {AgentaApi} from "@agentaai/api-client"
import {SlackLogo} from "@phosphor-icons/react"
import {Alert, Button, Typography, message} from "antd"

import {useChannelConnectionActions, useChannelSetupQuery} from "@/oss/state/channels"

import ChannelSetupCredentialsForm from "./ChannelSetupCredentialsForm"
import {ChannelsSectionHeader} from "./ChannelsSection"

// Read back out of the generated manifest instead of recomputed here -- one URL, one source.
export function extractSlackRequestUrl(
    document: AgentaApi.ChannelSetupDoc | null | undefined,
): string | null {
    if (!document?.content) return null
    try {
        const parsed = JSON.parse(document.content) as {
            settings?: {event_subscriptions?: {request_url?: string}}
        }
        return parsed.settings?.event_subscriptions?.request_url ?? null
    } catch {
        return null
    }
}

// The service's own verification error, shown as-is, never reworded.
export function extractConnectionErrorMessage(err: unknown): string {
    if (err && typeof err === "object" && "body" in err) {
        const body = (err as {body?: unknown}).body
        if (body && typeof body === "object" && "detail" in body) {
            const detail = (body as {detail?: unknown}).detail
            if (typeof detail === "string" && detail) return detail
        }
    }
    if (err instanceof Error && err.message) return err.message
    return "Failed to verify the connection"
}

// Settings -> Channels -> Add Slack -> Use your own Slack app: the manifest an operator needs before they have anything to connect.
export default function SlackOwnAppSection() {
    const {setup, isLoading} = useChannelSetupQuery("slack")
    const {create} = useChannelConnectionActions()
    const [submitting, setSubmitting] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string | null>(null)

    const document = setup?.document
    const requestUrl = extractSlackRequestUrl(document)

    const handleSubmit = async (payload: {
        data: Record<string, unknown>
        credentials: Record<string, unknown>
    }) => {
        setSubmitting(true)
        setErrorMessage(null)
        try {
            await create({
                channel: "slack",
                // enterprise_id is a declared identity key with no source (not a setup field, not discovered); "" is correct for a per-workspace install.
                data: {...payload.data, enterprise_id: ""},
                credentials: payload.credentials,
            })
            message.success("Slack connection verified and created")
        } catch (err) {
            setErrorMessage(extractConnectionErrorMessage(err))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <section className="flex flex-col gap-3">
            <ChannelsSectionHeader
                icon={<SlackLogo size={16} />}
                title="Add Slack"
                description="Use your own Slack app. We do not create a Slack app for anyone -- you build it, in your workspace, under your control."
            />
            {isLoading ? (
                <Typography.Text type="secondary">Loading the manifest...</Typography.Text>
            ) : !document ? (
                <Typography.Text type="secondary">
                    No manifest is available for this deployment.
                </Typography.Text>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <Typography.Text strong>1. Create the app from a manifest</Typography.Text>
                        {setup?.instructions?.length ? (
                            <ol className="ml-4 list-decimal text-sm text-colorTextSecondary">
                                {setup.instructions.map((step) => (
                                    <li key={step}>{step}</li>
                                ))}
                            </ol>
                        ) : null}
                        {requestUrl ? (
                            <Typography.Text className="text-xs">
                                Slack must be able to reach this deployment at{" "}
                                <Typography.Text code>{requestUrl}</Typography.Text>. On a local
                                deployment that means a tunnel -- Slack cannot reach a laptop
                                directly.
                            </Typography.Text>
                        ) : null}
                        <div className="flex items-center gap-2">
                            <CopyButton text={document.content} buttonText="Copy manifest" />
                            {document.link ? (
                                <Button href={document.link} target="_blank" rel="noreferrer">
                                    Open in Slack
                                </Button>
                            ) : null}
                        </div>
                        <pre className="ph-no-capture max-h-[220px] overflow-auto rounded border border-colorBorder bg-colorBgLayout p-2 text-xs">
                            {document.content}
                        </pre>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Typography.Text strong>2. Paste what Slack gives back</Typography.Text>
                        <Alert
                            type="info"
                            showIcon
                            message="Nothing is written until the token verifies. A wrong token leaves no row behind."
                        />
                        <ChannelSetupCredentialsForm
                            fields={setup?.fields}
                            onSubmit={handleSubmit}
                            submitting={submitting}
                            errorMessage={errorMessage}
                            submitLabel="Save and verify"
                        />
                    </div>
                </div>
            )}
        </section>
    )
}
