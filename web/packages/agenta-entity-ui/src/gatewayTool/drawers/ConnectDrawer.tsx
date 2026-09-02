import {useCallback, useEffect, useRef, useState} from "react"

import {
    createToolConnection,
    fetchToolConnection,
    invalidateToolConnections,
    useToolConnectionsQuery,
} from "@agenta/entities/gatewayTool"
import {getAgentaApiUrl, getAgentaWebUrl} from "@agenta/shared/api"
import {defaultConnectionName, generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"
import {EnhancedModal, ModalContent, ModalFooter, message} from "@agenta/ui"
import {
    Divider,
    Field,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import Image from "next/image"

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
    // One suffix per drawer instance keeps the derived slug stable while the author edits the name.
    const slugSuffixRef = useRef(randomAlphanumeric(3))

    // The slug is derived, not authored. Still sent: the API 500s on a null one.
    const {connections} = useToolConnectionsQuery()
    const existingCount = connections.filter(
        (connection) => connection.integration_key === integrationKey,
    ).length
    const seedName = defaultConnectionName(integrationName, existingCount)

    const nameTouchedRef = useRef(false)
    const [name, setName] = useState(seedName)
    const [nameError, setNameError] = useState<string | null>(null)
    const slug = generateDefaultSlug(
        name || integrationName || integrationKey,
        slugSuffixRef.current,
    )

    // The connections count lands after mount, so re-seed until the author types their own.
    useEffect(() => {
        if (!nameTouchedRef.current) setName(seedName)
    }, [seedName])

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    const handleClose = useCallback(() => {
        nameTouchedRef.current = false
        slugSuffixRef.current = randomAlphanumeric(3)
        setName(seedName)
        setNameError(null)
        setLoading(false)
        onClose()
    }, [onClose, seedName])

    // The shared one, not a local copy: it also invalidates ["triggers", "connections"], which
    // this drawer was missing — a tool connected here left the triggers list stale.
    const invalidateConnections = invalidateToolConnections

    const handleSubmit = useCallback(async () => {
        // The name is now the only authored field, so it carries the validation the slug used to.
        if (!name.trim() || !slug.trim()) {
            setNameError("Required")
            return
        }
        setNameError(null)
        try {
            setLoading(true)

            const result = await createToolConnection({
                connection: {
                    slug,
                    name: name || slug,
                    provider_key: DEFAULT_PROVIDER,
                    integration_key: integrationKey,
                    data: {auth_scheme: selectedMode},
                },
            })

            invalidateConnections()

            const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                ?.redirect_url
            if (typeof redirectUrl === "string" && redirectUrl) {
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
                            await fetchToolConnection(connectionId)
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
    }, [slug, name, selectedMode, integrationKey, handleClose, onSuccess, invalidateConnections])

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
                        <span className="font-medium leading-snug">{integrationName}</span>
                        {integrationDescription && (
                            <span className="text-xs text-colorTextDescription line-clamp-2">
                                {integrationDescription}
                            </span>
                        )}
                    </div>
                </div>

                <Divider className="!m-0" />

                {/* Form (explicitly controlled — no antd Form) */}
                <div className="flex flex-col gap-4">
                    <Field
                        label="Name"
                        required
                        tooltip="Display name for this connection"
                        error={nameError}
                    >
                        <Input
                            placeholder={`e.g. My ${integrationName} Account`}
                            value={name}
                            aria-invalid={nameError ? true : undefined}
                            onChange={(e) => {
                                nameTouchedRef.current = true
                                setName(e.target.value)
                                if (nameError && e.target.value.trim()) setNameError(null)
                            }}
                        />
                    </Field>

                    {availableModes.length > 1 && (
                        <Field label="Auth Method">
                            <Select
                                value={selectedMode}
                                onValueChange={(v) => setSelectedMode(v as AuthMode)}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {availableModes.map((m) => (
                                        <SelectItem key={m} value={m}>
                                            {m === "oauth" ? "OAuth" : "API Key"}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                    )}
                </div>

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
