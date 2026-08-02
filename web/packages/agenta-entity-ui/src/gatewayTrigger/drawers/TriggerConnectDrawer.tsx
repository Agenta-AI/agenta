import {useCallback, useEffect, useRef, useState} from "react"

import {createTriggerConnection, fetchTriggerConnection} from "@agenta/entities/gatewayTrigger"
import {getAgentaApiUrl, getAgentaWebUrl, queryClient} from "@agenta/shared/api"
import {generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"
import {EnhancedModal, message, ModalContent, ModalFooter} from "@agenta/ui"
import {
    Divider,
    Field,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
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

// Tools and triggers are independent surfaces over the SAME shared
// `gateway_connections` rows; invalidate both lists so a connection made from
// triggers shows up on the tools list and vice-versa.
function invalidateConnections() {
    queryClient.invalidateQueries({queryKey: ["triggers", "connections"]})
    queryClient.invalidateQueries({queryKey: ["tools", "connections"]})
    queryClient.invalidateQueries({queryKey: ["triggers", "catalog"]})
}

/** Label with an antd-style hover tooltip (no info icon — the label itself is the trigger). */
function LabelTooltip({label, tip}: {label: string; tip: string}) {
    return (
        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger asChild>
                    <span>{label}</span>
                </TooltipTrigger>
                <TooltipContent>{tip}</TooltipContent>
            </Tooltip>
        </TooltipProvider>
    )
}

export default function TriggerConnectDrawer({
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
    const slugTouchedRef = useRef(false)
    const slugSuffixRef = useRef(randomAlphanumeric(3))

    const buildDefaultSlug = useCallback((name: string) => {
        return generateDefaultSlug(name, slugSuffixRef.current)
    }, [])

    // Explicit controlled fields (the antd Form/useForm pair is gone). `slugError` carries
    // the one antd rule ({required: true, message: "Required"}), checked on submit.
    const [name, setName] = useState(integrationName)
    const [slug, setSlug] = useState(() => buildDefaultSlug(integrationName || ""))
    const [slugError, setSlugError] = useState<string | null>(null)

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    // Re-seed per open (was antd `initialValues` + `destroyOnClose` remount semantics):
    // the state lives on this component, which stays mounted across opens.
    useEffect(() => {
        if (!open) return
        setName(integrationName)
        setSlug(buildDefaultSlug(integrationName || ""))
        slugTouchedRef.current = false
        setSlugError(null)
    }, [open, integrationKey, integrationName, buildDefaultSlug])

    const handleClose = useCallback(() => {
        // Was `form.resetFields()`: rewind the controlled fields to their defaults.
        slugTouchedRef.current = false
        slugSuffixRef.current = randomAlphanumeric(3)
        setName(integrationName)
        setSlug(generateDefaultSlug(integrationName || "", slugSuffixRef.current))
        setSlugError(null)
        setLoading(false)
        onClose()
    }, [integrationName, onClose])

    const handleSubmit = useCallback(async () => {
        // Was `form.validateFields()`: the only rule is slug required.
        if (!slug.trim()) {
            setSlugError("Required")
            return
        }
        setSlugError(null)
        try {
            setLoading(true)

            const result = await createTriggerConnection({
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
                // Composio handles all auth (OAuth and API key) via its redirect UI.
                // The OAuth callback is the shared /tools/connections/callback (one
                // public contract over the shared row), so it posts the same
                // `tools:oauth:complete` message we listen for here.
                const popup = window.open(
                    redirectUrl,
                    "triggers_oauth",
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
                            await fetchTriggerConnection(connectionId)
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
    }, [slug, name, selectedMode, integrationKey, handleClose, onSuccess])

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
                        <span className="font-semibold leading-snug">{integrationName}</span>
                        {integrationDescription && (
                            <span className="text-xs line-clamp-2 text-[var(--ag-colorTextDescription)]">
                                {integrationDescription}
                            </span>
                        )}
                    </div>
                </div>

                <Divider className="m-0" />

                <div className="flex flex-col gap-4">
                    <Field
                        label={<LabelTooltip label="Name" tip="Display name for this connection" />}
                    >
                        <Input
                            placeholder={`e.g. My ${integrationName} Account`}
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value)
                                if (!slugTouchedRef.current) {
                                    // Was Form.setFieldValue("slug", …) inside onChange —
                                    // moved onto the direct controlled path.
                                    setSlug(
                                        buildDefaultSlug(e.target.value || integrationName || ""),
                                    )
                                }
                            }}
                        />
                    </Field>

                    <Field
                        label={
                            <LabelTooltip
                                label="Slug"
                                tip="Unique identifier — lowercase letters, numbers, and hyphens only"
                            />
                        }
                        required
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

                <Divider className="m-0" />

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
