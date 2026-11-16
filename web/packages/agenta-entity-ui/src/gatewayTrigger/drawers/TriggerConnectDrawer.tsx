import {useCallback, useEffect, useRef, useState} from "react"

import {
    createTriggerConnection,
    fetchTriggerConnection,
    useTriggerConnectionsQuery,
} from "@agenta/entities/gatewayTrigger"
import {createT, useT} from "@agenta/i18n"
import triggerConnectCatalog from "@agenta/i18n/catalogs/entityUi.triggerConnect"
import {getAgentaApiUrl, getAgentaWebUrl, getHostQueryClient} from "@agenta/shared/api"
import {defaultConnectionName, generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"
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

import {consentPopupFeatures} from "../../shared/consentPopupFeatures"

const DEFAULT_PROVIDER = "composio"

// The popup warning fires from the submit handler, outside render.
const tNow = createT(triggerConnectCatalog)

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
    /** A drawer panel to open inside, masking only that drawer. Absent = the page. */
    container?: HTMLElement | null
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
    const queryClient = getHostQueryClient()
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
    container = null,
}: Props) {
    const t = useT(triggerConnectCatalog)
    const [loading, setLoading] = useState(false)
    const nameTouchedRef = useRef(false)
    const slugSuffixRef = useRef(randomAlphanumeric(3))

    // The slug is derived, not authored. Still sent: the API 500s on a null one.
    const {connections} = useTriggerConnectionsQuery()
    const existingCount = connections.filter(
        (connection) => connection.integration_key === integrationKey,
    ).length
    const seedName = defaultConnectionName(integrationName, existingCount)

    const [name, setName] = useState(seedName)
    // A flag, not the message: the text is translated where it renders.
    const [nameMissing, setNameMissing] = useState(false)
    const slug = generateDefaultSlug(
        name || integrationName || integrationKey,
        slugSuffixRef.current,
    )

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    // Re-seed per open and when the count lands, but never over something the author typed.
    useEffect(() => {
        if (!open) return
        nameTouchedRef.current = false
        setNameMissing(false)
    }, [open, integrationKey])
    useEffect(() => {
        if (!nameTouchedRef.current) setName(seedName)
    }, [seedName])

    const handleClose = useCallback(() => {
        nameTouchedRef.current = false
        slugSuffixRef.current = randomAlphanumeric(3)
        setName(seedName)
        setNameMissing(false)
        setLoading(false)
        onClose()
    }, [seedName, onClose])

    const handleSubmit = useCallback(async () => {
        // The name is now the only authored field, so it carries the validation the slug used to.
        if (!name.trim() || !slug.trim()) {
            setNameMissing(true)
            return
        }
        setNameMissing(false)
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
                    consentPopupFeatures(window),
                )
                if (!popup) {
                    setLoading(false)
                    message.warning(tNow("entityUi.triggerConnect.popupBlocked"))
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
            title={t("entityUi.triggerConnect.connectTo", {name: integrationName})}
            footer={null}
            width={480}
            destroyOnClose
            getContainer={container ?? false}
            contained={!!container}
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
                        label={
                            <LabelTooltip
                                label={t("entityUi.triggerConnect.name")}
                                tip={t("entityUi.triggerConnect.nameTip")}
                            />
                        }
                        required
                        error={nameMissing ? t("entityUi.triggerConnect.required") : null}
                    >
                        <Input
                            placeholder={t("entityUi.triggerConnect.namePlaceholder", {
                                name: integrationName,
                            })}
                            value={name}
                            aria-invalid={nameMissing ? true : undefined}
                            onChange={(e) => {
                                nameTouchedRef.current = true
                                setName(e.target.value)
                                if (nameMissing && e.target.value.trim()) setNameMissing(false)
                            }}
                        />
                    </Field>

                    {availableModes.length > 1 && (
                        <Field label={t("entityUi.triggerConnect.authMethod")}>
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
                                            {m === "oauth"
                                                ? "OAuth"
                                                : t("entityUi.triggerConnect.apiKey")}
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
                    confirmLabel={t("entityUi.triggerConnect.connect")}
                    isLoading={loading}
                />
            </ModalContent>
        </EnhancedModal>
    )
}
