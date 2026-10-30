import {useCallback, useEffect, useRef, useState} from "react"

import {
    createToolConnection,
    fetchToolConnection,
    invalidateToolConnections,
    usePersonalToolConnections,
    useToolConnectionsQuery,
} from "@agenta/entities/gatewayTool"
import type {OwnerKind} from "@agenta/shared/types"
import {defaultConnectionName, generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"
import {EnhancedModal, ModalContent, ModalFooter} from "@agenta/ui"
import {
    Field,
    Input,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/ui/ui"
import Image from "next/image"

import {OwnerRadioGroup, type OwnerOption} from "../../secret/OwnerRadioGroup"
import {openToolAuthPopup} from "../utils/openToolAuthPopup"

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
    /** The connection is made; `owner` is who it belongs to. */
    onSuccess?: (owner: Exclude<OwnerKind, "organization">) => void
    /** A drawer panel to open inside, masking only that drawer. Absent = the page. */
    container?: HTMLElement | null
    /**
     * Who may own the new connection; the first is the default. Two ask "Who can use it", one
     * is used without asking. Absent, the connection is the project's.
     */
    owners?: Exclude<OwnerKind, "organization">[]
    /** The current project's name, for "Everyone in {project}". */
    projectName?: string
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
    container = null,
    owners,
    projectName,
}: Props) {
    const [chosenOwner, setOwner] = useState<Exclude<OwnerKind, "organization">>(
        owners?.[0] ?? "project",
    )
    // The allowed owners can change while the dialog is open (the switch was still loading):
    // a choice that is no longer allowed falls back to the first allowed owner.
    const owner = owners?.includes(chosenOwner) ? chosenOwner : (owners?.[0] ?? "project")
    const [loading, setLoading] = useState(false)
    /** A failed create said NOTHING before — the spinner just stopped, indistinguishable from
     * a popup that never came. The server's refusal must reach the person who clicked. */
    const [submitError, setSubmitError] = useState<string | null>(null)
    // One suffix per drawer instance keeps the derived slug stable while the author edits the name.
    const slugSuffixRef = useRef(randomAlphanumeric(3))

    // The slug is derived, not authored. Still sent: the API 500s on a null one.
    const {connections: projectConnections} = useToolConnectionsQuery()
    const {connections: personalConnections} = usePersonalToolConnections()
    const connections = owner === "user" ? (personalConnections ?? []) : (projectConnections ?? [])
    const existingCount = connections.filter(
        (connection) => connection.integration_key === integrationKey,
    ).length
    const seedName = defaultConnectionName(integrationName, existingCount)

    const nameTouchedRef = useRef(false)
    // An open auth popup's listener and poll; stopped if the drawer unmounts first.
    const popupCleanupRef = useRef<(() => void) | null>(null)
    useEffect(() => () => popupCleanupRef.current?.(), [])
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
        setSubmitError(null)
        setLoading(false)
        setOwner(owners?.[0] ?? "project")
        onClose()
    }, [onClose, seedName, owners])

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
        setSubmitError(null)
        try {
            setLoading(true)

            const result = await createToolConnection(
                {
                    connection: {
                        slug,
                        name: name || slug,
                        provider_key: DEFAULT_PROVIDER,
                        integration_key: integrationKey,
                        data: {auth_scheme: selectedMode},
                    },
                },
                owner,
            )

            invalidateConnections()

            const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                ?.redirect_url
            if (typeof redirectUrl === "string" && redirectUrl) {
                // Composio handles all auth (OAuth and API key) via their redirect UI
                const connectionId = result.connection?.id
                popupCleanupRef.current = openToolAuthPopup(redirectUrl, () => {
                    popupCleanupRef.current = null
                    void (async () => {
                        if (connectionId) {
                            try {
                                await fetchToolConnection(connectionId)
                            } catch {
                                /* best-effort */
                            }
                        }
                        invalidateConnections()
                        handleClose()
                        onSuccess?.(owner)
                    })()
                })
                if (!popupCleanupRef.current) setLoading(false)
            } else {
                handleClose()
                onSuccess?.(owner)
            }
        } catch (error) {
            console.error("[ConnectDrawer] create connection failed", error)
            setSubmitError(
                "Couldn't start the connection — the server rejected it. Try again; if it keeps failing, this deployment's connections provider isn't configured.",
            )
            setLoading(false)
        }
    }, [
        slug,
        name,
        selectedMode,
        integrationKey,
        owner,
        handleClose,
        onSuccess,
        invalidateConnections,
    ])

    const ownerOptions: OwnerOption<Exclude<OwnerKind, "organization">>[] = [
        {
            value: "user",
            label: "Only me",
            note: `Used when you run an agent that uses each person's own ${integrationName}. Your first ${integrationName} account becomes your default.`,
        },
        {
            value: "project",
            label: `Everyone in ${projectName ?? "this project"}`,
            note: "An agent in this project can use it as the agent's account, for every person who runs it.",
        },
    ]

    return (
        <EnhancedModal
            open={open}
            onCancel={handleClose}
            // The integration's mark heads the dialog, beside the close button.
            title={
                <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-border bg-background shadow-xs">
                    {integrationLogo ? (
                        <Image
                            src={integrationLogo}
                            alt={integrationName}
                            width={18}
                            height={18}
                            className="size-[18px] object-contain"
                            unoptimized
                        />
                    ) : (
                        <span className="text-sm font-semibold text-muted-foreground">
                            {integrationName.charAt(0).toUpperCase()}
                        </span>
                    )}
                </span>
            }
            footer={null}
            width={480}
            destroyOnClose
            getContainer={container ?? false}
            contained={!!container}
        >
            <ModalContent>
                <div className="flex flex-col gap-1">
                    <span className="text-base font-medium leading-snug text-foreground">
                        Connect {integrationName}
                    </span>
                    {integrationDescription && (
                        <span className="text-sm text-colorTextDescription line-clamp-2">
                            {integrationDescription}
                        </span>
                    )}
                </div>

                {/* Form (explicitly controlled — no antd Form) */}
                <div className="flex flex-col gap-4">
                    <Field label="Name" error={nameError}>
                        <Input
                            autoFocus
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

                    {owners && owners.length > 1 ? (
                        <Field label="Who can use it">
                            <OwnerRadioGroup
                                value={owner}
                                options={ownerOptions.filter((option) =>
                                    owners.includes(option.value),
                                )}
                                onChange={setOwner}
                            />
                        </Field>
                    ) : null}

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

                {submitError ? (
                    <p className="m-0 text-xs leading-snug text-[var(--ag-colorError)]">
                        {submitError}
                    </p>
                ) : null}

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
