import {useCallback, useRef, useState} from "react"

import {EnhancedModal, ModalContent, ModalFooter} from "@agenta/ui"
import {Divider, Form, Input, message, Select, Tooltip, Typography} from "antd"
import Image from "next/image"

import {queryClient} from "@/oss/lib/api/queryClient"
import {getAgentaApiUrl, getAgentaWebUrl} from "@/oss/lib/helpers/api"
import {createConnection, fetchConnection} from "@/oss/services/tools/api"

import {generateDefaultSlug, randomAlphanumeric} from "../utils/slugify"

const DEFAULT_PROVIDER = "composio"

type AuthMode = "oauth" | "api_key"

interface Props {
    open: boolean
    integrationKey: string
    integrationName: string
    integrationLogo?: string
    integrationDescription?: string
    authSchemes: string[]
    onClose: () => void
    onSuccess?: () => void
}

function resolveAvailableModes(authSchemes: string[]): AuthMode[] {
    const modes: AuthMode[] = []
    if (authSchemes.some((s) => s.toLowerCase().includes("oauth"))) modes.push("oauth")
    if (
        authSchemes.some(
            (s) => s.toLowerCase().includes("api_key") || s.toLowerCase().includes("basic"),
        )
    )
        modes.push("api_key")
    if (modes.length === 0) modes.push("oauth")
    return modes
}

export default function ConnectDrawer({
    open,
    integrationKey,
    integrationName,
    integrationLogo,
    integrationDescription,
    authSchemes,
    onClose,
    onSuccess,
}: Props) {
    const [loading, setLoading] = useState(false)
    const [form] = Form.useForm()
    // Track whether the user has manually edited the slug field.
    // While false, slug auto-tracks the name field.
    const slugTouchedRef = useRef(false)
    const slugSuffixRef = useRef(randomAlphanumeric(3))

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    const handleClose = useCallback(() => {
        form.resetFields()
        slugTouchedRef.current = false
        slugSuffixRef.current = randomAlphanumeric(3)
        setLoading(false)
        onClose()
    }, [form, onClose])

    const buildDefaultSlug = useCallback((name: string) => {
        return generateDefaultSlug(name, slugSuffixRef.current)
    }, [])

    const invalidateConnections = useCallback(() => {
        queryClient.invalidateQueries({queryKey: ["tools", "connections"]})
        queryClient.invalidateQueries({queryKey: ["tools", "catalog"]})
    }, [])

    const handleSubmit = useCallback(async () => {
        try {
            const values = await form.validateFields()
            setLoading(true)

            const result = await createConnection({
                connection: {
                    slug: values.slug,
                    name: values.name || values.slug,
                    provider_key: DEFAULT_PROVIDER,
                    integration_key: integrationKey,
                    data: {auth_scheme: selectedMode},
                },
            })

            invalidateConnections()

            const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                ?.redirect_url
            if (redirectUrl) {
                // Composio handles all auth (OAuth and API key) via their redirect UI
                const popup = window.open(
                    redirectUrl,
                    "tools_oauth",
                    "width=600,height=700,popup=yes",
                )
                if (!popup) {
                    setLoading(false)
                    message.warning("Popup blocked. Redirecting in this tab.")
                    window.location.assign(redirectUrl)
                    return
                }

                const connectionId = result.connection?.id

                const onAuthDone = async () => {
                    window.focus()
                    if (connectionId) {
                        try {
                            await fetchConnection(connectionId)
                        } catch {
                            /* best-effort */
                        }
                    }
                    invalidateConnections()
                    handleClose()
                    onSuccess?.()
                }

                const trustedOrigins = new Set<string>([window.location.origin])
                for (const url of [getAgentaApiUrl(), getAgentaWebUrl()]) {
                    if (!url) continue
                    try {
                        trustedOrigins.add(new URL(url).origin)
                    } catch {
                        // ignore invalid env URLs
                    }
                }

                const handler = (event: MessageEvent) => {
                    if (
                        event.data?.type === "tools:oauth:complete" &&
                        trustedOrigins.has(event.origin)
                    ) {
                        window.removeEventListener("message", handler)
                        void onAuthDone()
                    }
                }
                window.addEventListener("message", handler)

                // Fallback: detect popup closed
                const pollTimer = setInterval(() => {
                    if (popup && popup.closed) {
                        clearInterval(pollTimer)
                        window.removeEventListener("message", handler)
                        void onAuthDone()
                    }
                }, 1000)
            } else {
                handleClose()
                onSuccess?.()
            }
        } catch {
            setLoading(false)
        }
    }, [form, selectedMode, integrationKey, handleClose, onSuccess, invalidateConnections])

    return (
        <EnhancedModal
            open={open}
            onCancel={handleClose}
            title={`Connect to ${integrationName}`}
            footer={null}
            width={480}
            destroyOnClose
        >
            <ModalContent>
                {/* Integration header */}
                <div className="flex items-center gap-3">
                    {integrationLogo && (
                        <Image
                            src={integrationLogo}
                            alt={integrationName}
                            width={36}
                            height={36}
                            className="w-9 h-9 rounded object-contain shrink-0"
                            unoptimized
                        />
                    )}
                    <div className="flex flex-col min-w-0">
                        <Typography.Text strong className="leading-snug">
                            {integrationName}
                        </Typography.Text>
                        {integrationDescription && (
                            <Typography.Text type="secondary" className="!text-xs line-clamp-2">
                                {integrationDescription}
                            </Typography.Text>
                        )}
                    </div>
                </div>

                <Divider className="!m-0" />

                {/* Form */}
                <Form
                    form={form}
                    layout="vertical"
                    className="!mb-0"
                    initialValues={{
                        name: integrationName,
                        slug: buildDefaultSlug(integrationName),
                    }}
                    requiredMark={(label, {required}) => (
                        <>
                            {label}
                            {required && <span className="text-red-500 ml-1">*</span>}
                        </>
                    )}
                >
                    <Form.Item
                        name="name"
                        label={
                            <Tooltip title="Display name for this connection">
                                <span>Name</span>
                            </Tooltip>
                        }
                        className="!mb-4"
                    >
                        <Input
                            placeholder={`e.g. My ${integrationName} Account`}
                            onChange={(e) => {
                                if (!slugTouchedRef.current) {
                                    form.setFieldValue(
                                        "slug",
                                        buildDefaultSlug(e.target.value || integrationName),
                                    )
                                }
                            }}
                        />
                    </Form.Item>

                    <Form.Item
                        name="slug"
                        label={
                            <Tooltip title="Unique identifier used in tool call slugs — lowercase letters, numbers, and hyphens only">
                                <span>Slug</span>
                            </Tooltip>
                        }
                        rules={[{required: true, message: "Required"}]}
                        className={availableModes.length > 1 ? "!mb-4" : "!mb-0"}
                    >
                        <Input
                            placeholder={`e.g. my-${integrationKey}`}
                            onChange={() => {
                                slugTouchedRef.current = true
                            }}
                        />
                    </Form.Item>

                    {availableModes.length > 1 && (
                        <Form.Item label="Auth Method" className="!mb-0">
                            <Select
                                value={selectedMode}
                                onChange={setSelectedMode}
                                options={availableModes.map((m) => ({
                                    value: m,
                                    label: m === "oauth" ? "OAuth" : "API Key",
                                }))}
                            />
                        </Form.Item>
                    )}
                </Form>

                <Divider className="!m-0" />

                <ModalFooter
                    onCancel={handleClose}
                    onConfirm={handleSubmit}
                    confirmLabel="Connect"
                    isLoading={loading}
                />
            </ModalContent>
        </EnhancedModal>
    )
}
