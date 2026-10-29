import {type ReactNode, useMemo, useState} from "react"

import {secretChoicesQueryAtomFamily} from "@agenta/entities/accountChoice"
import {
    CustomSecretFormat,
    personalAccountsAccessAtom,
    personalNamedSecretsAtom,
    personalSecretsQueryAtom,
    useVaultSecret,
    type NamedSecretRow,
} from "@agenta/entities/secret"
import {workflowMolecule} from "@agenta/entities/workflow"
import {getSettingsSidebarIcon} from "@agenta/settings"
import type {LlmProvider} from "@agenta/shared/types"
import {formatDay} from "@agenta/shared/utils/dateTime"
import {Tag} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button, IconTile} from "@agenta/ui/ui"
import {LockKey, PencilSimpleLine, Plus, Trash} from "@phosphor-icons/react"
import {atom, useAtom, useAtomValue} from "jotai"
import {atomWithStorage} from "jotai/utils"

import {SettingsPageActions} from "../SettingsPageShell"
import {agentsBySecret, secretIdsKey, showsYours, usedByLine} from "../shared/accountOwners"
import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsGroupHeading} from "../shared/SettingsGroupHeading"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {usePhoneColumns} from "../shared/usePhoneColumns"
import {YoursEmpty} from "../shared/YoursEmpty"

const STARS = "*******"

/** `abc*******xyz` for text (the server's preview when the value is write-only); key names for json. */
const maskContent = (record: NamedSecretRow): string => {
    const {format, content, keyPreview} = record
    if (format === CustomSecretFormat.Json) {
        const keys = content && typeof content === "object" ? Object.keys(content) : []
        return keys.length ? `{ ${keys.join(", ")} }` : "{ }"
    }
    const text = typeof content === "string" ? content : ""
    if (text.length > 12) return `${text.slice(0, 3)}${STARS}${text.slice(-3)}`
    if (text) return STARS
    return keyPreview ? keyPreview.replace(/\*+/, STARS) : STARS
}

export interface NamedSecretTableProps {
    /**
     * Create/edit secret dialog — the host's. A person's own secret arrives with
     * `ownerKind: "user"`, which the save keeps.
     */
    renderConfigureDialog?: (state: {
        selectedSecret: NamedSecretRow | null
        open: boolean
        onClose: () => void
    }) => React.ReactNode
    /** Delete dialog — the model registry's. */
    renderDeleteDialog?: (state: {
        selectedProvider: LlmProvider | null
        open: boolean
        onClose: () => void
    }) => React.ReactNode
    /** The project group's heading: the project switch. Shown with "Yours". */
    projectSwitch?: ReactNode
    /** How many projects the person has in the organization, for the empty "Yours" note. */
    projectCount?: number
}

interface SecretRow extends NamedSecretRow {
    key: string
}

const COLUMNS: ListTableColumn[] = [
    {key: "name", label: "Name", width: "minmax(0,2fr)"},
    {key: "content", label: "Value", width: "minmax(0,1fr)"},
    {key: "format", label: "Format", width: "minmax(0,0.6fr)"},
    {key: "created_at", label: "Created", width: "minmax(0,1fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "32px"},
]
const PHONE_KEYS = ["name", "actions"]

/** Per viewer, like the other pages' groups: "Yours" folds away and stays folded. */
const yoursCollapsedAtom = atomWithStorage("agenta:settings:secrets-yours-collapsed", false)

const toRows = (secrets: NamedSecretRow[] | undefined): SecretRow[] =>
    (secrets ?? []).map((secret, index) => ({
        ...secret,
        key: secret.id || secret.name || `secret-${index}`,
    }))

/** "Used by Release bot, Triage": the agents whose choice names this secret. */
const UsedBy = ({agentIds}: {agentIds: string[]}) => {
    const namesAtom = useMemo(
        () =>
            atom((get) =>
                agentIds.map((agentId) => get(workflowMolecule.selectors.artifactName(agentId))),
            ),
        [agentIds],
    )
    const line = usedByLine(useAtomValue(namesAtom))
    return line ? (
        <span className="truncate text-[12.5px] text-muted-foreground">{line}</span>
    ) : null
}

const NO_AGENTS: string[] = []

interface SecretsListProps {
    rows: SecretRow[]
    loading: boolean
    /** The agents per secret, for the "Used by" line; absent, no line. */
    usedBy?: Map<string, string[]> | null
    empty?: ReactNode
    onOpen?: (record: SecretRow) => void
    onDelete?: (record: SecretRow) => void
}

/** One owner's secrets as a table, with its own column header row. */
const SecretsList = ({rows, loading, usedBy, empty, onOpen, onDelete}: SecretsListProps) => {
    const {columns, shows} = usePhoneColumns(COLUMNS, PHONE_KEYS)
    return (
        <ListTable<SecretRow>
            className="ph-no-capture"
            columns={columns}
            groups={[{key: "secrets", label: null, rows}]}
            wrapRow={hoverableRow}
            rowKey={(record) => record.key}
            minWidth={0}
            onOpenRow={onOpen}
            loading={loading && rows.length === 0}
            hideHeader={!loading && rows.length === 0}
            empty={empty}
            renderRow={(record) => (
                <>
                    <span className="flex min-w-0 items-center gap-2.5">
                        <IconTile
                            size={28}
                            tone="muted"
                            aria-hidden="true"
                            className="border border-solid border-border bg-muted text-muted-foreground"
                        >
                            <LockKey />
                        </IconTile>
                        <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">{record.name}</span>
                            <span className="truncate font-mono text-[12.5px] text-muted-foreground">
                                {record.slug}
                            </span>
                            {usedBy ? (
                                <UsedBy agentIds={usedBy.get(record.id ?? "") ?? NO_AGENTS} />
                            ) : null}
                        </span>
                    </span>
                    {shows("content") ? (
                        <span className="ph-no-capture truncate font-mono text-[13px]">
                            {maskContent(record)}
                        </span>
                    ) : null}
                    {shows("format") ? (
                        <span className="flex min-w-0">
                            <Tag>{record.format}</Tag>
                        </span>
                    ) : null}
                    {shows("created_at") ? (
                        <span className="truncate text-muted-foreground">
                            {record.created_at
                                ? formatDay({
                                      date: record.created_at,
                                      outputFormat: "YYYY-MM-DD HH:mm",
                                  })
                                : "-"}
                        </span>
                    ) : null}
                    <SettingsRowMenu
                        label="Secret actions"
                        items={[
                            {
                                key: "edit",
                                label: "Edit",
                                icon: <PencilSimpleLine size={14} />,
                                hidden: !onOpen,
                                onClick: () => onOpen?.(record),
                            },
                            {type: "divider"},
                            {
                                key: "delete",
                                label: "Delete",
                                icon: <Trash size={14} />,
                                danger: true,
                                hidden: !onDelete,
                                onClick: () => onDelete?.(record),
                            },
                        ]}
                    />
                </>
            )}
        />
    )
}

/**
 * The person's own secrets with the agents that use each one. One account-choices read for all
 * of them, so the "Used by" lines cost one request.
 */
const useUsedBy = (rows: SecretRow[]): Map<string, string[]> | null => {
    const key = secretIdsKey(rows.map((row) => row.id))
    const query = useAtomValue(secretChoicesQueryAtomFamily(key))
    return useMemo(() => {
        if (!key) return new Map()
        return query.data ? agentsBySecret(query.data) : null
    }, [key, query.data])
}

/**
 * Settings → Secrets. With personal accounts on, the person's own secrets ("Yours", each with
 * the agents that use it) come first, then the project's under the project switch.
 */
export const NamedSecretTable = ({
    renderConfigureDialog,
    renderDeleteDialog,
    projectSwitch,
    projectCount,
}: NamedSecretTableProps) => {
    const {namedSecrets, loading} = useVaultSecret()
    const access = useAtomValue(personalAccountsAccessAtom)
    const personalSecrets = useAtomValue(personalNamedSecretsAtom)
    const personalQuery = useAtomValue(personalSecretsQueryAtom)
    const [yoursCollapsed, setYoursCollapsed] = useAtom(yoursCollapsedAtom)
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false)
    const [selectedSecret, setSelectedSecret] = useState<NamedSecretRow | null>(null)

    const yours = showsYours(access)
    const rows = useMemo(() => toRows(namedSecrets), [namedSecrets])
    const yoursRows = useMemo(
        () => (yours ? toRows(personalSecrets) : []),
        [yours, personalSecrets],
    )
    const usedBy = useUsedBy(yoursRows)

    const openCreate = () => {
        setSelectedSecret(null)
        setIsConfigModalOpen(true)
    }
    const openSecret = renderConfigureDialog
        ? (record: SecretRow) => {
              setSelectedSecret(record)
              setIsConfigModalOpen(true)
          }
        : undefined
    const deleteSecret = renderDeleteDialog
        ? (record: SecretRow) => {
              setSelectedSecret(record)
              setIsDeleteModalOpen(true)
          }
        : undefined

    // The form is the host's; without one this would open nothing, so it is absent rather than dead.
    const create = renderConfigureDialog ? (
        <Button disabled={loading} onClick={openCreate}>
            <Plus size={14} />
            Create secret
        </Button>
    ) : null

    const emptyState = (
        <SettingsEmpty
            icon={getSettingsSidebarIcon("secrets")}
            title="No secrets yet"
            description="Store a named secret to reference credentials without exposing their values."
            action={create}
        />
    )

    // With nothing of either owner, the page keeps its one empty state.
    const nothingYet =
        !loading && !personalQuery.isPending && rows.length === 0 && yoursRows.length === 0

    return (
        <>
            <section className="flex flex-col">
                <SettingsPageActions>{create}</SettingsPageActions>
                {yours && !nothingYet ? (
                    <div className="flex flex-col gap-8">
                        <section className="flex flex-col gap-3">
                            <SettingsGroupHeading
                                label="Yours"
                                count={yoursRows.length}
                                collapsed={yoursCollapsed}
                                onToggle={() => setYoursCollapsed((value) => !value)}
                            />
                            {yoursCollapsed ? null : (
                                <SecretsList
                                    rows={yoursRows}
                                    loading={personalQuery.isPending}
                                    usedBy={usedBy}
                                    empty={<YoursEmpty projectCount={projectCount} />}
                                    onOpen={openSecret}
                                    onDelete={deleteSecret}
                                />
                            )}
                        </section>
                        <section className="flex flex-col gap-3">
                            <SettingsGroupHeading
                                label={projectSwitch ?? "Project"}
                                count={rows.length}
                            />
                            <SecretsList
                                rows={rows}
                                loading={loading}
                                empty={
                                    <SettingsEmpty
                                        plain
                                        icon={getSettingsSidebarIcon("secrets")}
                                        title="No secrets yet"
                                        description="Store a named secret to reference credentials without exposing their values."
                                    />
                                }
                                onOpen={openSecret}
                                onDelete={deleteSecret}
                            />
                        </section>
                    </div>
                ) : (
                    <SecretsList
                        rows={rows}
                        loading={loading}
                        empty={emptyState}
                        onOpen={openSecret}
                        onDelete={deleteSecret}
                    />
                )}
            </section>

            {renderConfigureDialog?.({
                selectedSecret,
                open: isConfigModalOpen,
                onClose: () => {
                    setSelectedSecret(null)
                    setIsConfigModalOpen(false)
                },
            })}

            {renderDeleteDialog?.({
                // `NamedSecretRow extends LlmProvider`, so this needs no cast.
                selectedProvider: selectedSecret,
                open: isDeleteModalOpen,
                onClose: () => {
                    setSelectedSecret(null)
                    setIsDeleteModalOpen(false)
                },
            })}
        </>
    )
}
