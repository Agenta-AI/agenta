import {useCallback, useState} from "react"

import {EnhancedModal, ModalContent, ModalFooter} from "@agenta/ui"
import {Divider, Form, Input, Select, Typography} from "antd"
import Image from "next/image"

import {queryClient} from "@/oss/lib/api/queryClient"
import {createConnection, fetchConnection} from "@/oss/services/tools/api"

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

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    const handleClose = useCallback(() => {
        form.resetFields()
        setLoading(false)
        onClose()
    }, [form, onClose])

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

                const handler = (event: MessageEvent) => {
                    if (event.data?.type === "tools:oauth:complete") {
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
                    requiredMark={(label, {required}) => (
                        <>
                            {label}
                            {required && <span className="text-red-500 ml-1">*</span>}
                        </>
                    )}
                >
                    <Form.Item
                        name="slug"
                        label="slug (used in tools)"
                        rules={[{required: true, message: "Required"}]}
                        className="!mb-4"
                    >
                        <Input placeholder={`e.g. my-${integrationKey}`} />
                    </Form.Item>

                    <Form.Item
                        name="name"
                        label="name (used as display)"
                        className={availableModes.length > 1 ? "!mb-4" : "!mb-0"}
                    >
                        <Input placeholder={`e.g. My ${integrationName} Account`} />
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
