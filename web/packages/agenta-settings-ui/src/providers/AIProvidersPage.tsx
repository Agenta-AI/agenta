import {type ReactNode, useCallback, useMemo} from "react"

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
    type OrganizationProjectChoice,
    type ProviderOwnerChoice,
} from "@agenta/entity-ui/secretProvider"
import {useAtomValue, useSetAtom} from "jotai"

import {
    ProvidersPanel,
    type ProviderRemovalState,
    type ProvidersGroup,
    type ProvidersSource,
} from "./ProvidersPanel"
import {useOrganizationProvidersGroup} from "./useOrganizationProvidersGroup"

export type {ProviderRemovalState}

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
                    connection.title !== connection.name ? connection.title : null,
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
                `Agenta could not remove ${connection.name}. Try again.`,
            onSaved: mutate,
        }
    }, [connections, loading, capabilities, deleteSecret, mutate])
}

/**
 * Settings → AI providers: the subscription cards, the project's connections under the project
 * switch, the organization's connections, then the catalog. A new connection belongs to the
 * project; someone who may manage the organization's connections chooses in the drawer.
 */
export const AIProvidersPage = ({
    renderRemoveDialog,
    subscriptionDocsUrl = SUBSCRIPTION_DOCS_URL,
    organization,
    projectSwitch,
}: AIProvidersPageProps) => {
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

    const groups = useMemo<ProvidersGroup[]>(
        () => [
            {key: "project", label: projectSwitch ?? "Connected", source: project},
            ...(organizationGroup ? [organizationGroup] : []),
        ],
        [projectSwitch, project, organizationGroup],
    )

    const ownerChoiceFor = useCallback(
        (kind: string): ProviderOwnerChoice | undefined =>
            organization && manageScope && !NOT_SHAREABLE_KINDS.has(kind)
                ? {projectName: organization.projectName, organization: manageScope}
                : undefined,
        [organization, manageScope],
    )

    return (
        <ProvidersPanel
            groups={groups}
            subscriptions={project.connections}
            ownerChoiceFor={ownerChoiceFor}
            loading={project.loading}
            renderRemoveDialog={renderRemoveDialog}
            subscriptionDocsUrl={subscriptionDocsUrl}
        />
    )
}
