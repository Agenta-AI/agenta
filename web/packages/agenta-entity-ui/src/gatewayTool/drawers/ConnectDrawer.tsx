import {useCallback, useRef, useState} from "react"

import {createToolConnection, fetchToolConnection} from "@agenta/entities/gatewayTool"
import {getAgentaApiUrl, getAgentaWebUrl, queryClient} from "@agenta/shared/api"
import {generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"
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
    // Track whether the user has manually edited the slug field.
    // While false, slug auto-tracks the name field.
    const slugTouchedRef = useRef(false)
    const slugSuffixRef = useRef(randomAlphanumeric(3))

    const buildDefaultSlug = useCallback((name: string) => {
        return generateDefaultSlug(name, slugSuffixRef.current)
    }, [])

    // Explicitly controlled form state (the antd Form was internal-only here).
    const [name, setName] = useState(integrationName)
    const [slug, setSlug] = useState(() => buildDefaultSlug(integrationName || ""))
    const [slugError, setSlugError] = useState<string | null>(null)

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    const handleClose = useCallback(() => {
        slugTouchedRef.current = false
        slugSuffixRef.current = randomAlphanumeric(3)
        setName(integrationName)
        setSlug(buildDefaultSlug(integrationName || ""))
        setSlugError(null)
        setLoading(false)
        onClose()
    }, [onClose, integrationName, buildDefaultSlug])

    const invalidateConnections = useCallback(() => {
        queryClient.invalidateQueries({queryKey: ["tools", "connections"]})
        queryClient.invalidateQueries({queryKey: ["tools", "catalog"]})
    }, [])

    const handleSubmit = useCallback(async () => {
        // Was the antd `required` rule on the slug Form.Item — now the direct path.
        if (!slug.trim()) {
            setSlugError("Required")
            return
        }
        setSlugError(null)
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
                    <Field label="Name" tooltip="Display name for this connection">
                        <Input
                            placeholder={`e.g. My ${integrationName} Account`}
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value)
                                // Was in the Input's onChange inside the antd Form —
                                // slug auto-tracks name until the user edits the slug.
                                if (!slugTouchedRef.current) {
                                    setSlug(
                                        buildDefaultSlug(e.target.value || integrationName || ""),
                                    )
                                }
                            }}
                        />
                    </Field>

                    <Field
                        label="Slug"
                        required
                        tooltip="Unique identifier used in tool call slugs — lowercase letters, numbers, and hyphens only"
                        error={slugError}
                    >
                        <Input
                            placeholder={`e.g. my-${integrationKey}`}
                            value={slug}
                            aria-invalid={slugError ? true : undefined}
                            onChange={(e) => {
                                slugTouchedRef.current = true
                                setSlug(e.target.value)
                                if (slugError && e.target.value.trim()) setSlugError(null)
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
