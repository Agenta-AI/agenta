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
import {OwnerChip, type SecretOwner} from "@agenta/entity-ui/secret"
import {formatLocale, useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsSecretsCatalog from "@agenta/i18n/catalogs/settings.secrets"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import {getSettingsSidebarIcon} from "@agenta/settings"
import type {LlmProvider} from "@agenta/shared/types"
import {LoadError} from "@agenta/ui/components/presentational"
import {
    formatListDateTime,
    LIST_COLUMN_WIDTH,
    ListTable,
    ListTableNameCell,
    type ListTableColumn,
    type ListTableGroup,
} from "@agenta/ui/list-table"
import {Button, IconTile} from "@agenta/ui/ui"
import {PencilSimpleLine, Plus, Trash, Vault} from "@phosphor-icons/react"
import {atom, useAtomValue} from "jotai"

import {SettingsPageActions} from "../SettingsPageShell"
import {
    agentsBySecret,
    ownerShown,
    ownersWithDefault,
    secretIdsKey,
    showsYours,
    usedByLine,
    type OwnerFilter,
} from "../shared/accountOwners"
import {ConnectionsToolbar} from "../shared/ConnectionsToolbar"
import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {usePhoneColumns} from "../shared/usePhoneColumns"

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
    /** The host's create/edit dialog; `owners` lists a new secret's owners, the default first. */
    renderConfigureDialog?: (state: {
        selectedSecret: NamedSecretRow | null
        open: boolean
        owners: SecretOwner[] | undefined
        onClose: () => void
    }) => ReactNode
    /** Delete dialog — the model registry's. */
    renderDeleteDialog?: (state: {
        selectedProvider: LlmProvider | null
        open: boolean
        onClose: () => void
    }) => ReactNode
    /** Who may own a new secret (`addAccountOwners`); two show the owner segment and field. */
    owners?: SecretOwner[]
}

interface SecretRow extends NamedSecretRow {
    key: string
    owner: SecretOwner
}

const columnsFor = (t: ReturnType<typeof useT>): ListTableColumn[] => [
    {key: "name", label: t("common.name"), width: LIST_COLUMN_WIDTH.primary},
    {key: "content", label: t("settings.secrets.value"), width: LIST_COLUMN_WIDTH.secondary},
    {key: "created_at", label: t("common.created"), width: LIST_COLUMN_WIDTH.name},
    {key: "actions", label: t("common.actions"), srOnly: true, width: LIST_COLUMN_WIDTH.actions},
]
const PHONE_KEYS = ["name", "actions"]

const toRows = (secrets: NamedSecretRow[] | undefined, owner: SecretOwner): SecretRow[] =>
    (secrets ?? []).map((secret, index) => ({
        ...secret,
        owner,
        key: `${owner}:${secret.id || secret.name || index}`,
    }))

const matches = (row: SecretRow, term: string) =>
    !term || [row.name, row.slug].some((value) => value?.toLowerCase().includes(term))

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
    return line ? <> · {line}</> : null
}

const NO_AGENTS: string[] = []

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

/** Settings → Secrets: the person's own secrets first, then the project's; Owner narrows. */
export const NamedSecretTable = ({
    renderConfigureDialog,
    renderDeleteDialog,
    owners,
}: NamedSecretTableProps) => {
    const t = useT(commonCatalog, settingsSecretsCatalog, settingsSharedCatalog)
    const {namedSecrets, loading, loadFailed, mutate} = useVaultSecret()
    const access = useAtomValue(personalAccountsAccessAtom)
    const personalSecrets = useAtomValue(personalNamedSecretsAtom)
    const personalQuery = useAtomValue(personalSecretsQueryAtom)
    const [search, setSearch] = useState("")
    const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all")
    const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)
    const [isConfigModalOpen, setIsConfigModalOpen] = useState(false)
    const [selectedSecret, setSelectedSecret] = useState<NamedSecretRow | null>(null)

    const personal = showsYours(access)
    const projectRows = useMemo(() => toRows(namedSecrets, "project"), [namedSecrets])
    const personalRows = useMemo(
        () => (personal ? toRows(personalSecrets, "user") : []),
        [personal, personalSecrets],
    )
    const usedBy = useUsedBy(personalRows)
    const {columns, shows, wide} = usePhoneColumns(
        useMemo(() => columnsFor(t), [t]),
        PHONE_KEYS,
    )

    const term = search.trim().toLowerCase()
    // One list, narrow owners first; the owner tab narrows it, a chip names the owner in All.
    const groups = useMemo<ListTableGroup<SecretRow>[]>(() => {
        const rows = [
            ...(personal && ownerShown(ownerFilter, "user") ? personalRows : []),
            ...(ownerShown(ownerFilter, "project") ? projectRows : []),
        ].filter((row) => matches(row, term))
        return [{key: "secrets", label: null, rows}]
    }, [ownerFilter, personal, personalRows, projectRows, term])
    const showsChip = personal && ownerFilter === "all"

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
            {t("settings.secrets.createSecret")}
        </Button>
    ) : null

    const narrowed = Boolean(term)
    // Each owner tab has its own empty state and start button; the button opens the form on it.
    const tabEmpty =
        ownerFilter === "user"
            ? {
                  title: t("settings.secrets.emptyPersonalTitle"),
                  body: t("settings.secrets.emptyPersonalBody"),
                  cta: t("settings.secrets.createPersonal"),
              }
            : ownerFilter === "project"
              ? {
                    title: t("settings.secrets.emptyProjectTitle"),
                    body: t("settings.secrets.emptyProjectBody"),
                    cta: t("settings.secrets.createProject"),
                }
              : null
    const empty = term ? (
        <SettingsEmpty
            compact
            icon={getSettingsSidebarIcon("secrets")}
            title={t("settings.shared.noMatchTitle")}
            description={t("settings.shared.noMatchSearchBody")}
            action={
                <Button variant="outline" onClick={() => setSearch("")}>
                    {t("common.clearSearch")}
                </Button>
            }
        />
    ) : (
        <SettingsEmpty
            compact
                icon={getSettingsSidebarIcon("secrets")}
                title={tabEmpty?.title ?? t("settings.secrets.emptyTitle")}
                description={tabEmpty?.body ?? t("settings.secrets.emptyDescription")}
                action={
                    tabEmpty && renderConfigureDialog ? (
                        <Button disabled={loading} onClick={openCreate}>
                            <Plus size={14} />
                            {tabEmpty.cta}
                        </Button>
                    ) : (
                        create
                    )
                }
            />
    )

    return (
        <>
            <SettingsPageActions>{create}</SettingsPageActions>
            <ConnectionsToolbar
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder={t("settings.secrets.searchSecrets")}
                owners={owners}
                owner={ownerFilter}
                onOwnerChange={setOwnerFilter}
            />
            {!loadFailed && personal && personalQuery.isError ? (
                <LoadError
                    framed
                    title={t("settings.secrets.loadFailed")}
                    onRetry={() => void personalQuery.refetch()}
                />
            ) : null}
            {loadFailed ? (
                <LoadError
                    framed
                    title={t("settings.secrets.loadFailed")}
                    onRetry={() => void mutate()}
                />
            ) : (
                <ListTable<SecretRow>
                    className="ph-no-capture"
                    columns={columns}
                    groups={groups}
                    wrapRow={hoverableRow}
                    rowKey={(record) => record.key}
                    minWidth={0}
                    onOpenRow={openSecret}
                    loading={
                        groups.every((group) => group.rows.length === 0) &&
                        !narrowed &&
                        (loading || (personal && personalQuery.isPending))
                    }
                    // A phone shows one column: a lone header there says nothing.
                    hideHeader={!wide}
                    skeleton={{mark: true}}
                    empty={empty}
                    renderRow={(record) => (
                        <>
                            <ListTableNameCell
                                mark={
                                    <IconTile size={32} tone="neutral" aria-hidden="true">
                                        <Vault />
                                    </IconTile>
                                }
                                title={record.name ?? ""}
                                badge={showsChip ? <OwnerChip owner={record.owner} /> : undefined}
                                meta={
                                    <>
                                        <span className="text-code">{record.slug}</span>
                                        {record.owner === "user" && usedBy ? (
                                            <UsedBy
                                                agentIds={usedBy.get(record.id ?? "") ?? NO_AGENTS}
                                            />
                                        ) : null}
                                    </>
                                }
                            />
                            {shows("content") ? (
                                <span className="ph-no-capture truncate text-code text-muted-foreground">
                                    {maskContent(record)}
                                </span>
                            ) : null}
                            {shows("created_at") ? (
                                <span className="truncate text-label tabular-nums text-muted-foreground">
                                    {formatListDateTime(record.created_at, formatLocale())}
                                </span>
                            ) : null}
                            <SettingsRowMenu
                                label={t("settings.secrets.secretActions")}
                                items={[
                                    {
                                        key: "edit",
                                        label: t("common.edit"),
                                        icon: <PencilSimpleLine size={14} />,
                                        hidden: !openSecret,
                                        onClick: () => openSecret?.(record),
                                    },
                                    {type: "divider"},
                                    {
                                        key: "delete",
                                        label: t("common.delete"),
                                        icon: <Trash size={14} />,
                                        danger: true,
                                        hidden: !deleteSecret,
                                        onClick: () => deleteSecret?.(record),
                                    },
                                ]}
                            />
                        </>
                    )}
                />
            )}

            {renderConfigureDialog?.({
                selectedSecret,
                open: isConfigModalOpen,
                owners: owners && ownersWithDefault(owners, ownerFilter),
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
