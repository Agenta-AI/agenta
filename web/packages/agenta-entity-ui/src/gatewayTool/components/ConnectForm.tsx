/**
 * The connect form of an app: its fields, and the start of the connection. One form for every
 * place: the connect view (the agent panel and Settings) and the connect dialog of the hosts that
 * keep a dialog. The connection belongs to the project, or to the person with "Only me".
 */
import {useCallback, useEffect, useRef, useState} from "react"

import {
    createToolConnection,
    fetchToolConnection,
    invalidateToolConnections,
    usePersonalToolConnections,
    useToolConnectionsQuery,
} from "@agenta/entities/gatewayTool"
import {useT} from "@agenta/i18n"
import accountSwitchCatalog from "@agenta/i18n/catalogs/entityUi.accountSwitch"
import connectFormCatalog from "@agenta/i18n/catalogs/entityUi.connectForm"
import type {OwnerKind} from "@agenta/shared/types"
import {defaultConnectionName, generateDefaultSlug, randomAlphanumeric} from "@agenta/shared/utils"
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

import {AccountSwitch} from "../../accounts/AccountSwitch"
import {openToolAuthPopup} from "../utils/openToolAuthPopup"

const DEFAULT_PROVIDER = "composio"

export type ConnectionOwner = Exclude<OwnerKind, "organization">
type AuthMode = "oauth" | "api_key"

export interface ConnectFormInput {
    integrationKey: string
    integrationName: string
    authSchemes: string[]
    /**
     * Who may own the new connection; the first is the default. Two ask "Who can use it", one
     * is used without asking. Absent, the connection is the project's.
     */
    owners?: ConnectionOwner[]
    /** The connection exists (its sign-in may still be running): its slug and who owns it. */
    onCreated?: (created: CreatedConnection) => void
}

/** The connection a connect form made. */
export interface CreatedConnection {
    slug: string
    owner: ConnectionOwner
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

/** The form state and the connect step. `submit` resolves true once the connection is made. */
export function useConnectForm({
    integrationKey,
    integrationName,
    authSchemes,
    owners,
    onCreated,
}: ConnectFormInput) {
    const [chosenOwner, setOwner] = useState<ConnectionOwner>(owners?.[0] ?? "project")
    // The allowed owners can change while the form is open (the switch was still loading):
    // a choice that is no longer allowed falls back to the first allowed owner.
    const owner = owners?.includes(chosenOwner) ? chosenOwner : (owners?.[0] ?? "project")
    const [loading, setLoading] = useState(false)
    /** The server refused to start the connection; the form stays with its values. */
    const [submitFailed, setSubmitFailed] = useState(false)
    // One suffix per form keeps the derived slug stable while the author edits the name.
    const slugSuffixRef = useRef(randomAlphanumeric(3))

    // The slug is derived, not authored. Still sent: the API 500s on a null one.
    const {connections: projectConnections} = useToolConnectionsQuery()
    const {connections: personalConnections} = usePersonalToolConnections()
    const connections = owner === "user" ? (personalConnections ?? []) : (projectConnections ?? [])
    const existingCount = connections.filter(
        (connection) => connection.integration_key === integrationKey,
    ).length
    const seedName = defaultConnectionName(integrationName, existingCount)

    const [nameTouched, setNameTouched] = useState(false)
    // An open auth popup's listener and poll; stopped if the form unmounts first.
    const popupCleanupRef = useRef<(() => void) | null>(null)
    useEffect(() => () => popupCleanupRef.current?.(), [])
    const [typedName, setTypedName] = useState("")
    // The seed follows the connections count until the author types a name of their own.
    const name = nameTouched ? typedName : seedName
    // A flag, not the message: the text is translated where it renders.
    const [nameMissing, setNameMissing] = useState(false)
    const slug = generateDefaultSlug(
        name || integrationName || integrationKey,
        slugSuffixRef.current,
    )

    const availableModes = resolveAvailableModes(authSchemes)
    const [selectedMode, setSelectedMode] = useState<AuthMode>(availableModes[0] || "oauth")

    const setName = useCallback((next: string) => {
        setNameTouched(true)
        setTypedName(next)
        if (next.trim()) setNameMissing(false)
    }, [])

    const submit = useCallback(async (): Promise<boolean> => {
        // The name is the only authored field, so it carries the validation the slug used to.
        if (!name.trim() || !slug.trim()) {
            setNameMissing(true)
            return false
        }
        setNameMissing(false)
        setSubmitFailed(false)
        setLoading(true)
        try {
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
            invalidateToolConnections()
            onCreated?.({slug, owner})

            const redirectUrl = (result.connection?.data as Record<string, unknown> | undefined)
                ?.redirect_url
            if (typeof redirectUrl !== "string" || !redirectUrl) return true
            // The provider runs the sign-in (OAuth and API key) in its own window. The form waits
            // until that window is done, then the connection is read once more.
            const connectionId = result.connection?.id
            return await new Promise<boolean>((resolve) => {
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
                        invalidateToolConnections()
                        resolve(true)
                    })()
                })
                // Popup blocked: the sign-in continues in this tab, which leaves the page.
                if (!popupCleanupRef.current) resolve(true)
            })
        } catch (error) {
            console.error("[ConnectForm] create connection failed", error)
            setSubmitFailed(true)
            return false
        } finally {
            setLoading(false)
        }
    }, [slug, name, selectedMode, integrationKey, owner, onCreated])

    return {
        name,
        setName,
        nameMissing,
        owner,
        setOwner,
        owners,
        availableModes,
        selectedMode,
        setSelectedMode,
        submitFailed,
        loading,
        submit,
        valid: Boolean(name.trim()),
    }
}

export type ConnectFormState = ReturnType<typeof useConnectForm>

/** The app mark: its logo in a bordered tile, or its first letter. */
export function ConnectAppMark({name, logo}: {name: string; logo?: string | null}) {
    return (
        <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-solid border-border bg-background shadow-xs">
            {logo ? (
                <Image
                    src={logo}
                    alt={name}
                    width={18}
                    height={18}
                    className="size-[18px] object-contain"
                    unoptimized
                />
            ) : (
                <span className="text-sm font-semibold text-muted-foreground">
                    {name.charAt(0).toUpperCase()}
                </span>
            )}
        </span>
    )
}

/** "Connect {name}", the description, and the fields: Name, Who can use it, Auth Method. */
export function ConnectFormFields({
    form,
    integrationName,
    integrationDescription,
    projectName,
}: {
    form: ConnectFormState
    integrationName: string
    integrationDescription?: string | null
    /** The current project's name, for "Everyone in {project}". */
    projectName?: string
}) {
    const t = useT(connectFormCatalog, accountSwitchCatalog)
    // Each choice has one short sentence; the full sentence of the selected one shows under it.
    const ownerChoices = [
        {
            value: "user" as const,
            label: t("entityUi.connectForm.onlyMe"),
            note: t("entityUi.accountSwitch.onlyMeShort"),
            detail: t("entityUi.connectForm.onlyMeNote", {name: integrationName}),
        },
        {
            value: "project" as const,
            label: projectName
                ? t("entityUi.connectForm.everyoneInProject", {project: projectName})
                : t("entityUi.connectForm.everyoneInThisProject"),
            note: t("entityUi.accountSwitch.everyoneShort"),
            detail: t("entityUi.connectForm.everyoneNote"),
        },
    ]
    const {owners} = form
    return (
        <>
            <div className="flex flex-col gap-1">
                <span className="text-base font-medium leading-snug text-foreground">
                    {t("entityUi.connectForm.connectName", {name: integrationName})}
                </span>
                {integrationDescription && (
                    <span className="text-sm text-colorTextDescription line-clamp-2">
                        {integrationDescription}
                    </span>
                )}
            </div>

            <div className="flex flex-col gap-4">
                <Field
                    label={t("entityUi.connectForm.name")}
                    error={form.nameMissing ? t("entityUi.connectForm.required") : null}
                >
                    <Input
                        autoFocus
                        placeholder={t("entityUi.connectForm.namePlaceholder", {
                            name: integrationName,
                        })}
                        value={form.name}
                        aria-invalid={form.nameMissing ? true : undefined}
                        onChange={(e) => form.setName(e.target.value)}
                    />
                </Field>

                {owners && owners.length > 1 ? (
                    <Field label={t("entityUi.connectForm.whoCanUseIt")}>
                        <div className="flex flex-col gap-2">
                            <AccountSwitch
                                value={form.owner}
                                choices={ownerChoices.filter((choice) =>
                                    owners.includes(choice.value),
                                )}
                                onChange={form.setOwner}
                                aria-label={t("entityUi.connectForm.whoCanUseIt")}
                            />
                            <span className="text-xs text-colorTextTertiary">
                                {ownerChoices.find((choice) => choice.value === form.owner)?.detail}
                            </span>
                        </div>
                    </Field>
                ) : null}

                {form.availableModes.length > 1 && (
                    <Field label={t("entityUi.connectForm.authMethod")}>
                        <Select
                            value={form.selectedMode}
                            onValueChange={(v) => form.setSelectedMode(v as AuthMode)}
                        >
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {form.availableModes.map((m) => (
                                    <SelectItem key={m} value={m}>
                                        {/* "OAuth" is the protocol name, the same in every language. */}
                                        {/* eslint-disable-next-line agenta-i18n/no-hardcoded-text */}
                                        {m === "oauth" ? "OAuth" : t("entityUi.connectForm.apiKey")}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </Field>
                )}
            </div>

            {form.submitFailed ? (
                <p className="m-0 text-xs leading-snug text-[var(--ag-colorError)]">
                    {t("entityUi.connectForm.submitFailed")}
                </p>
            ) : null}
        </>
    )
}
