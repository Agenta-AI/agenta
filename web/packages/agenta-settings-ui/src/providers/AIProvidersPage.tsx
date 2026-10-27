import {type ReactNode, useMemo, useState} from "react"

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
import {type OrganizationProjectChoice} from "@agenta/entity-ui/secretProvider"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/ui/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {OrganizationProvidersPanel} from "./OrganizationProvidersPanel"
import {ProvidersPanel, type ProviderRemovalState, type ProvidersSource} from "./ProvidersPanel"

export type {ProviderRemovalState}

/** The capability map is global; the key only records which surface asked for it. */
const HARNESS_CATALOG_KEY = "agenta:settings:ai-providers"

export const SUBSCRIPTION_DOCS_URL = "https://docs.agenta.ai/self-host/quick-start"

/** What the Project and Organization tabs need from the host. */
export interface AIProvidersOrganization {
    /** The current project's name, for "Project · {project}". */
    projectName: string
    /** The organization's name, for "Organization · {org}" and the drawer's copy. */
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
    /** Turns on the Project and Organization tabs. Absent keeps the project page alone. */
    organization?: AIProvidersOrganization
}

/** Settings → AI providers, with one tab per owner when the host names the organization. */
export const AIProvidersPage = ({organization, ...props}: AIProvidersPageProps) => {
    const [tab, setTab] = useState<"project" | "organization">("project")
    if (!organization) return <ProjectProvidersPanel {...props} />
    return (
        <Tabs value={tab} onValueChange={(next) => setTab(next as typeof tab)}>
            <TabsList variant="line" className="mb-5">
                <TabsTrigger value="project">Project · {organization.projectName}</TabsTrigger>
                <TabsTrigger value="organization">Organization · {organization.name}</TabsTrigger>
            </TabsList>
            <TabsContent value="project">
                <ProjectProvidersPanel {...props} />
            </TabsContent>
            <TabsContent value="organization">
                <OrganizationProvidersPanel
                    scope={{
                        name: organization.name,
                        projectChoice: organization.projectChoice,
                        plansHref: organization.plansHref,
                    }}
                    renderRemoveDialog={props.renderRemoveDialog}
                    subscriptionDocsUrl={props.subscriptionDocsUrl ?? SUBSCRIPTION_DOCS_URL}
                />
            </TabsContent>
        </Tabs>
    )
}

/** The project's own AI providers: one row per connection, and every provider stays connectable. */
const ProjectProvidersPanel = ({
    renderRemoveDialog,
    subscriptionDocsUrl = SUBSCRIPTION_DOCS_URL,
}: Omit<AIProvidersPageProps, "organization">) => {
    const {loading, mutate} = useVaultSecret()
    const connections = useAtomValue(providerConnectionsAtom)
    const capabilities = useAtomValue(harnessCapabilitiesAtomFamily(HARNESS_CATALOG_KEY))
    const deleteSecret = useSetAtom(deleteSecretAtom)

    const source = useMemo<ProvidersSource>(() => {
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
            catalog: {},
            subscriptions: connections,
            onSaved: mutate,
        }
    }, [connections, loading, capabilities, deleteSecret, mutate])

    return (
        <ProvidersPanel
            source={source}
            renderRemoveDialog={renderRemoveDialog}
            subscriptionDocsUrl={subscriptionDocsUrl}
        />
    )
}
