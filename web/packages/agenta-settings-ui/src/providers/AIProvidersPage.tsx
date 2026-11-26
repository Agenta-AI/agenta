import {type ReactNode, useCallback, useMemo, useState} from "react"

import {
    activeModelsSummary,
    isSubscriptionConnection,
    deleteSecretAtom,
    SecretManagementPolicy,
    providerConnectionsAtom,
    useVaultSecret,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {harnessCapabilitiesAtomFamily} from "@agenta/entities/workflow"
import {useConnectionsHeading} from "@agenta/entity-ui/secret"
import {
    credentialSummaryText,
    subscriptionStatusLine,
    type OrganizationProjectChoice,
    type ProviderOwnerChoice,
} from "@agenta/entity-ui/secretProvider"
import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import settingsProvidersCatalog from "@agenta/i18n/catalogs/settings.providers"
import {useAtomValue, useSetAtom} from "jotai"

import {ownerShown, ownersWithDefault, PAGE_OWNERS, type OwnerFilter} from "../shared/accountOwners"
import {ConnectionsToolbar} from "../shared/ConnectionsToolbar"

import {
    ProvidersPanel,
    type ProviderRemovalState,
    type ProvidersGroup,
    type ProvidersSource,
    providerTitle,
} from "./ProvidersPanel"
import {useOrganizationProvidersGroup} from "./useOrganizationProvidersGroup"

export type {ProviderRemovalState}

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

const NO_OWNERS: readonly never[] = []

export const SUBSCRIPTION_DOCS_URL = "https://docs.agenta.ai/self-host/quick-start"

/** The deployment kinds the LLM gateway does not serve, so they cannot belong to the organization. */
const NOT_SHAREABLE_KINDS = new Set(["bedrock"])

/** What the organization's group and the drawer's Owner field need from the host. */
export interface AIProvidersOrganization {
    /** The current project's name, for the Project owner's sentence. */
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
}

/** The project's own connections: one row per key or subscription. */
const useProjectProvidersSource = (): ProvidersSource => {
    const t = useT(settingsProvidersCatalog, commonCatalog)
    const {loading, mutate} = useVaultSecret()
    const connections = useAtomValue(providerConnectionsAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const deleteSecret = useSetAtom(deleteSecretAtom)

    return useMemo(() => {
        // Manager-only rows 409 on edit; the drawer still gets every connection.
        const rows = connections.filter(
            (connection) => connection.managementPolicy !== SecretManagementPolicy.ManagerOnly,
        )
        return {
            connections,
            rows,
            loading: loading && rows.length === 0,
            // A subscription has no key and no model list worth a line: its sign-in status only.
            describe: (connection: ProviderConnection) =>
                isSubscriptionConnection(connection)
                    ? subscriptionStatusLine(connection.subscription) || t("common.notConnected")
                    : [
                          connection.title !== connection.name
                              ? providerTitle(connection.kind, connection.title, t)
                              : null,
                          credentialSummaryText(connection),
                          activeModelsSummary(connection, capabilities, {
                              // No saved list: the row says nothing about models.
                              defaults: "",
                              active: (active, total) =>
                                  t("settings.providers.modelsActive", {active, total}),
                          }),
                      ]
                          .filter(Boolean)
                          .join(" · "),
            manage: true,
            offersSubscriptions: true,
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

/** Settings → AI providers: one Connected list, the sign-ins to start, then the catalog. */
export const AIProvidersPage = ({
    renderRemoveDialog,
    subscriptionDocsUrl = SUBSCRIPTION_DOCS_URL,
    organization,
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
    const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>("all")
    const connectionsHeading = useConnectionsHeading()
    const [search, setSearch] = useState("")

    const projectGroup = useMemo<ProvidersGroup>(
        () => ({key: "project", owner: "project" as const, source: project}),
        [project],
    )
    const shownGroups = useMemo(
        () =>
            [
                ownerShown(ownerFilter, "project") ? projectGroup : null,
                organizationGroup && ownerShown(ownerFilter, "organization")
                    ? organizationGroup
                    : null,
            ].filter((group): group is ProvidersGroup => group !== null),
        [organizationGroup, ownerFilter, projectGroup],
    )

    const ownerChoiceFor = useCallback(
        (kind: string): ProviderOwnerChoice | undefined =>
            organization && manageScope && !NOT_SHAREABLE_KINDS.has(kind)
                ? {
                      projectName: organization.projectName,
                      organization: manageScope,
                      connections: organizationGroup?.source.connections ?? [],
                      defaultOwner: ownersWithDefault(PAGE_OWNERS.providers, ownerFilter)[0],
                  }
                : undefined,
        [organization, manageScope, organizationGroup, ownerFilter],
    )

    return (
        <>
            <ConnectionsToolbar
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder={t("settings.providers.searchProviders")}
                owners={organizationGroup ? PAGE_OWNERS.providers : NO_OWNERS}
                owner={ownerFilter}
                onOwnerChange={setOwnerFilter}
            />
            <ProvidersPanel
                groups={shownGroups}
                query={search}
                projectGroup={projectGroup}
                ownerChoiceFor={ownerChoiceFor}
                loading={project.loading}
                ownerChips={ownerFilter === "all" && Boolean(organizationGroup)}
                connectedLabel={organizationGroup ? connectionsHeading(ownerFilter) : undefined}
                renderRemoveDialog={renderRemoveDialog}
                subscriptionDocsUrl={subscriptionDocsUrl}
            />
        </>
    )
}
