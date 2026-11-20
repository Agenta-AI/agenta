import {type ReactNode, useCallback, useMemo, useState} from "react"

import {
    activeModelsSummary,
    credentialSummary,
    deleteSecretAtom,
    isSubscriptionConnection,
    SecretManagementPolicy,
    providerConnectionsAtom,
    useVaultSecret,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {
    builtinModelsView,
    providerAddView,
    providerConnectionView,
    ProviderListBody,
    ProviderOwnerChoiceContext,
    type OrganizationProjectChoice,
    type ProviderOwnerChoice,
} from "@agenta/entity-ui/secretProvider"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {useViewOpener, type ViewTarget} from "@agenta/ui/view-stack"
import {Trash} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {SettingsRowMenu} from "../shared/SettingsRowMenu"

import {
    ProvidersPanel,
    type ProviderRemovalState,
    type ProvidersSource,
    providerTitle,
} from "./ProvidersPanel"
import {useOrganizationProvidersGroup} from "./useOrganizationProvidersGroup"

export type {ProviderRemovalState}

const PROJECT: ViewTarget = {kind: "project"}

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

export const SUBSCRIPTION_DOCS_URL = "https://docs.agenta.ai/self-host/quick-start"

/** The deployment kinds the LLM gateway does not serve, so they cannot belong to the organization. */
const NOT_SHAREABLE_KINDS = new Set(["bedrock"])

/** What the organization's group and the drawer's "Who can use it" need from the host. */
export interface AIProvidersOrganization {
    /** The current project's name, for "Everyone in {project}". */
    projectName: string
    /** The organization's name, for "{org} organization" and the drawer's copy. */
    name: string
    /** `choose` (EE with RBAC), `plan` (EE without it), `all` (OSS). */
    projectChoice: OrganizationProjectChoice
    /** Where "See plans" points. */
    plansHref?: string
}

export interface AIProvidersPageProps {
    /** The host's confirm surface; the page runs the delete. Absent hides the Delete verb. */
    renderRemoveDialog?: (state: ProviderRemovalState) => ReactNode
    /** Where "configured in the deployment" points. */
    subscriptionDocsUrl?: string
    /** Adds the organization's group. Absent keeps the project's connections alone. */
    organization?: AIProvidersOrganization
    /** The project group's heading: the project switch. Absent, it reads "Connected". */
    projectSwitch?: ReactNode
}

/** The project's own connections: one row per connection, every provider stays connectable. */
const useProjectProvidersSource = (): ProvidersSource => {
    const t = useT(settingsProvidersCatalog, commonCatalog)
    const {loading, mutate} = useVaultSecret()
    const connections = useAtomValue(providerConnectionsAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const deleteSecret = useSetAtom(deleteSecretAtom)

    return useMemo(() => {
        // Manager-only rows 409 on edit; the drawer still gets every connection so none look
        // keyless.
        const rows = connections.filter(
            (connection) =>
                connection.managementPolicy !== SecretManagementPolicy.ManagerOnly &&
                !isSubscriptionConnection(connection),
        )
        return {
            connections,
            rows,
            loading: loading && rows.length === 0,
            describe: (connection: ProviderConnection) =>
                [
                    connection.title !== connection.name
                        ? providerTitle(connection.kind, connection.title, t)
                        : null,
                    credentialSummary(connection),
                    activeModelsSummary(connection, capabilities),
                ]
                    .filter(Boolean)
                    .join(" · "),
            manage: true,
            remove: async (connection: ProviderConnection) => {
                await deleteSecret(connection.source)
                mutate()
            },
            removeFailed: (_failure: unknown, connection: ProviderConnection) =>
                t("settings.providers.removeFailed", {name: connection.name}),
            onSaved: mutate,
        }
    }, [connections, loading, capabilities, deleteSecret, mutate, t])
}

/** Delete of one of the project's connections, with the host's confirm surface. */
const useProjectRemoval = (source: ProvidersSource) => {
    const [connection, setConnection] = useState<ProviderConnection | null>(null)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const state: ProviderRemovalState = {
        connection,
        open: !!connection,
        pending,
        error,
        onConfirm: () => {
            if (!connection) return
            setPending(true)
            setError(null)
            source
                .remove(connection)
                .catch((failure: unknown) => setError(source.removeFailed(failure, connection)))
                .finally(() => {
                    setConnection(null)
                    setPending(false)
                })
        },
        onClose: () => setConnection(null),
    }
    return {
        state,
        request: (next: ProviderConnection) => {
            setError(null)
            setConnection(next)
        },
    }
}

/**
 * Settings → AI providers: the Model providers list as the root of a container, with Delete on
 * each row, then the organization's connections. "Add a provider or subscription" and a row's
 * Edit open the same views as the panel, in a drawer. Someone who may manage the organization's
 * connections chooses "Who can use it" on a new connection.
 */
export const AIProvidersPage = ({
    renderRemoveDialog,
    subscriptionDocsUrl = SUBSCRIPTION_DOCS_URL,
    organization,
    projectSwitch,
}: AIProvidersPageProps) => {
    const t = useT(settingsProvidersCatalog, commonCatalog)
    const project = useProjectProvidersSource()
    const scope = useMemo(
        () =>
            organization
                ? {
                      name: organization.name,
                      projectChoice: organization.projectChoice,
                      plansHref: organization.plansHref,
                  }
                : null,
        [organization],
    )
    const {group: organizationGroup, manageScope} = useOrganizationProvidersGroup(scope)
    const views = useViewOpener()
    const removal = useProjectRemoval(project)

    const ownerChoiceFor = useCallback(
        (kind: string): ProviderOwnerChoice | undefined =>
            organization && manageScope && !NOT_SHAREABLE_KINDS.has(kind)
                ? {
                      projectName: organization.projectName,
                      organization: manageScope,
                      connections: organizationGroup?.source.connections ?? [],
                  }
                : undefined,
        [organization, manageScope, organizationGroup],
    )

    return (
        <ProviderOwnerChoiceContext.Provider value={ownerChoiceFor}>
            <div className="ph-no-capture flex flex-col">
                {projectSwitch ? <div className="px-4 pt-2">{projectSwitch}</div> : null}
                <ProviderListBody
                    onAdd={() => void views.open(providerAddView, {}, PROJECT)}
                    onOpenBuiltin={() => void views.open(builtinModelsView, {}, PROJECT)}
                    onOpenConnection={(connection) =>
                        void views.open(
                            providerConnectionView,
                            {kind: connection.kind, connectionId: connection.id},
                            PROJECT,
                        )
                    }
                    rowMenu={
                        renderRemoveDialog
                            ? (connection) => (
                                  <SettingsRowMenu
                                      label={t("settings.providers.actionsFor", {
                                          name: connection.name,
                                      })}
                                      items={[
                                          {
                                              key: "delete",
                                              label: t("common.delete"),
                                              icon: <Trash size={14} />,
                                              danger: true,
                                              onClick: () => removal.request(connection),
                                          },
                                      ]}
                                  />
                              )
                            : undefined
                    }
                    footer={
                        organizationGroup ? (
                            <ProvidersPanel
                                groups={[organizationGroup]}
                                catalog={false}
                                renderRemoveDialog={renderRemoveDialog}
                                subscriptionDocsUrl={subscriptionDocsUrl}
                            />
                        ) : null
                    }
                />
                {views.drawer}
                {renderRemoveDialog?.(removal.state)}
            </div>
        </ProviderOwnerChoiceContext.Provider>
    )
}
