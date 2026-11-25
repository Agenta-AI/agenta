import {useCallback, useMemo, useState} from "react"

import {
    invalidateToolConnections,
    makeDefaultToolConnection,
    toolExecutionDrawerAtom,
    usePersonalToolConnections,
    useToolCatalogCategories,
    useToolConnectionActions,
    type ToolConnection,
} from "@agenta/entities/gatewayTool"
import {personalAccountsAccessAtom} from "@agenta/entities/secret"
import {
    categoryLabel,
    IntegrationCatalog,
    IntegrationConnectDialog,
    ToolExecutionDrawer,
    type CategorySelection,
    type ConnectionAction,
    type IntegrationCatalogControls,
    type IntegrationCatalogYours,
} from "@agenta/entity-ui/gatewayTool"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import settingsToolsCatalog from "@agenta/i18n/catalogs/settings.tools"
import {message} from "@agenta/ui/app-message"
import {FilterMenu, type FilterMenuSection} from "@agenta/ui/filter-menu"
import {SquaresFour, Tag} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import type {ConfirmDestructive} from "../confirm"
import {
    addAccountOwners,
    ownersWithDefault,
    showsYours,
    type OwnerFilter,
} from "../shared/accountOwners"
import {ConnectionsToolbar} from "../shared/ConnectionsToolbar"
import {LoadFailed} from "../shared/LoadFailed"
import {YoursEmpty} from "../shared/YoursEmpty"

/** Nouns for the page; a host that calls them something else passes its own. */
export interface GatewayToolsSectionCopy {
    run: string
    searchPlaceholder: string
}

const defaultCopy = (t: ReturnType<typeof useT>): GatewayToolsSectionCopy => ({
    run: t("settings.tools.runTool"),
    searchPlaceholder: t("settings.tools.searchTools"),
})

export interface GatewayToolsSectionProps {
    /** Destructive confirmation — the desktop's AlertPopup, a sheet elsewhere. */
    confirm?: ConfirmDestructive
    /** Overrides the nouns; defaults to the "tool" wording oss/ee use. */
    copy?: Partial<GatewayToolsSectionCopy>
    /** How many projects the person has in the organization, for the empty "Yours" note. */
    projectCount?: number
    /**
     * Whether the person may add the project's accounts (`edit_tools`). Without it, and with
     * personal accounts on, the connect dialog adds the person's own account without asking.
     */
    canEdit?: boolean
}

/** Settings › Integrations: the one integration list, as a page, with the page's own verbs. */
export default function GatewayToolsSection({
    confirm,
    copy: copyOverrides,
    projectCount,
    canEdit = true,
}: GatewayToolsSectionProps) {
    const t = useT(commonCatalog, settingsSharedCatalog, settingsToolsCatalog)
    const copy = useMemo<GatewayToolsSectionCopy>(
        () => ({...defaultCopy(t), ...copyOverrides}),
        [copyOverrides, t],
    )
    const access = useAtomValue(personalAccountsAccessAtom)
    const {
        connections: personalConnections,
        error: personalError,
        refetch: refetchPersonal,
    } = usePersonalToolConnections()
    const showYours = showsYours(access) && (personalConnections !== null || !!personalError)
    // The switch alone decides the owners, so a pending list read never defaults to the project.
    const connectOwners = addAccountOwners(access, canEdit)
    const {handleDelete, handleRevoke} = useToolConnectionActions()
    const setExecutionDrawer = useSetAtom(toolExecutionDrawerAtom)
    const [connectTarget, setConnectTarget] = useState<string | null>(null)
    const [query, setQuery] = useState("")
    const [category, setCategory] = useState<CategorySelection | null>(null)
    const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all")
    const {categories} = useToolCatalogCategories()
    const categorySection = useMemo<FilterMenuSection | null>(
        () =>
            categories.length
                ? {
                      key: "category",
                      label: t("settings.shared.filterCategory"),
                      icon: <Tag size={14} />,
                      value: category?.id ?? "all",
                      defaultValue: "all",
                      searchable: true,
                      options: [
                          {
                              value: "all",
                              label: t("settings.shared.ownerAll"),
                              icon: <SquaresFour size={14} />,
                          },
                          ...categories.map((item) => ({
                              value: item.id,
                              label: categoryLabel(item.name),
                          })),
                      ],
                      onChange: (value) => {
                          const picked = categories.find((item) => item.id === value)
                          setCategory(picked ? {id: picked.id, name: picked.name} : null)
                      },
                  }
                : null,
        [categories, category, t],
    )
    const controls = useMemo<IntegrationCatalogControls>(
        () => ({
            query,
            category,
            owner: ownerFilter === "user" || ownerFilter === "project" ? ownerFilter : "all",
        }),
        [category, ownerFilter, query],
    )

    const run = useMemo(
        () => ({
            label: copy.run,
            onRun: (record: ToolConnection) => {
                if (!record.id || !record.slug) return
                setExecutionDrawer({
                    connectionId: record.id,
                    connectionSlug: record.slug,
                    integrationKey: record.integration_key,
                })
            },
        }),
        [copy.run, setExecutionDrawer],
    )

    const confirmConnectionAction = useCallback(
        (action: ConnectionAction, connection: ToolConnection) => {
            const remove = action === "delete"
            confirm?.({
                title: remove
                    ? t("settings.tools.deleteConnectionTitle")
                    : t("settings.tools.revokeConnectionTitle"),
                message: remove
                    ? t("settings.tools.deleteConnectionMessage")
                    : t("settings.tools.revokeConnectionMessage"),
                onOk: async () => {
                    if (!connection.id) return
                    try {
                        await (remove ? handleDelete : handleRevoke)(connection.id)
                        message.success(
                            remove
                                ? t("settings.tools.connectionDeleted")
                                : t("settings.tools.connectionRevoked"),
                        )
                    } catch {
                        message.error(
                            remove
                                ? t("settings.tools.deleteConnectionFailed")
                                : t("settings.tools.revokeConnectionFailed"),
                        )
                    }
                },
            })
        },
        [confirm, handleDelete, handleRevoke, t],
    )

    // A person's default is what an agent that uses each person's own account picks for them.
    const yours = useMemo<IntegrationCatalogYours | undefined>(
        () =>
            showYours
                ? {
                      label: t("settings.shared.yours"),
                      empty: <YoursEmpty projectCount={projectCount} />,
                      error: personalError ? (
                          <LoadFailed
                              message={t("settings.tools.loadConnectionsFailed")}
                              onRetry={() => void refetchPersonal()}
                          />
                      ) : undefined,
                      makeDefault: {
                          label: t("settings.tools.makeDefault"),
                          defaultLabel: t("settings.tools.default"),
                          onMakeDefault: async (connection) => {
                              if (!connection.id) return
                              try {
                                  await makeDefaultToolConnection(connection.id)
                                  invalidateToolConnections()
                              } catch {
                                  message.error(t("settings.tools.makeDefaultFailed"))
                              }
                          },
                      },
                  }
                : undefined,
        [showYours, projectCount, personalError, refetchPersonal, t],
    )

    return (
        <>
            <ConnectionsToolbar
                search={query}
                onSearchChange={setQuery}
                searchPlaceholder={copy.searchPlaceholder}
                filter={
                    categorySection ? (
                        <FilterMenu
                            sections={[categorySection]}
                            align="start"
                            size="default"
                            onReset={() => setCategory(null)}
                            resetDisabled={category === null}
                        />
                    ) : null
                }
                owners={connectOwners}
                owner={ownerFilter}
                onOwnerChange={setOwnerFilter}
            />
            <section className="ph-no-capture">
                <IntegrationCatalog
                    layout="page"
                    searchPlaceholder={copy.searchPlaceholder}
                    yours={yours}
                    run={run}
                    confirmConnectionAction={confirm ? confirmConnectionAction : undefined}
                    onConnect={(integrationKey) => setConnectTarget(integrationKey)}
                    controls={controls}
                    canManageProject={canEdit}
                />
            </section>

            <ToolExecutionDrawer />
            {connectTarget ? (
                <IntegrationConnectDialog
                    integrationKey={connectTarget}
                    owners={connectOwners && ownersWithDefault(connectOwners, ownerFilter)}
                    onClosed={() => setConnectTarget(null)}
                />
            ) : null}
        </>
    )
}
