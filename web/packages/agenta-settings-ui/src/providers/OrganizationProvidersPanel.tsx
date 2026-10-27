/**
 * AI providers → Organization tab.
 *
 * An organization owner or admin sees every organization connection with who may use it, then
 * today's catalog, and connects a provider once for the projects they choose. Anyone else sees
 * only the connections their project may use, read-only: no catalog, no row menu, and a locked
 * drawer that keeps Test.
 */
import {type ReactNode, useMemo} from "react"

import {
    deleteSecretAtom,
    isSubscriptionConnection,
    managedOrganizationConnectionsAtom,
    organizationConnectionsAccessAtom,
    organizationProjectsQueryAtom,
    organizationProviderConnectionsAtom,
    organizationSecretsQueryAtom,
    refreshVaultSecretsAtom,
    subscriptionStatusLine,
    vaultSecretsWithOrganizationQueryAtom,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {
    organizationSaveError,
    type OrganizationConnectionScope,
} from "@agenta/entity-ui/secretProvider"
import {message} from "@agenta/ui/app-message"
import {Button} from "@agenta/ui/ui"
import {WarningCircle} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom} from "jotai"

import {ProvidersPanel, type ProviderRemovalState, type ProvidersSource} from "./ProvidersPanel"

/** The deployment kinds the LLM gateway does not serve, so they cannot belong to the organization. */
const NOT_SHAREABLE = {
    kinds: new Set(["bedrock"]),
    note: "Can't belong to the organization. Connect Bedrock in each project.",
}

export interface OrganizationProvidersPanelProps {
    scope: Omit<OrganizationConnectionScope, "readOnly" | "projects">
    renderRemoveDialog?: (state: ProviderRemovalState) => ReactNode
    subscriptionDocsUrl: string
}

/** Who may use a connection, in the row's words. */
const projectsSummary = (
    connection: ProviderConnection,
    names: Map<string, string>,
): string | null => {
    if (connection.availability === "all_projects") return "All projects"
    if (connection.availability !== "selected_projects") return null
    const ids = connection.selectedProjectIds ?? []
    if (!ids.length) return "No projects"
    const picked = ids.flatMap((id) => {
        const name = names.get(id)
        return name ? [name] : []
    })
    return picked.length === ids.length
        ? picked.join(", ")
        : `${ids.length} ${ids.length === 1 ? "project" : "projects"}`
}

const rowDescription = (connection: ProviderConnection, projects: string | null): string =>
    [connection.title, connection.hasStoredCredential ? "Key saved" : null, projects]
        .filter(Boolean)
        .join(" · ")

const LoadFailed = ({onRetry}: {onRetry: () => void}) => (
    <div className="flex items-center gap-3 text-sm text-colorTextSecondary">
        <span className="flex items-center gap-1.5">
            <WarningCircle size={16} className="text-colorError" />
            Couldn&apos;t load the organization connections.
        </span>
        <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
        </Button>
    </div>
)

const EmptyNote = ({manage}: {manage: boolean}) => (
    <div className="flex flex-col gap-0.5">
        <span className="text-[14.5px] font-medium leading-5 text-foreground">
            No organization connections yet
        </span>
        {manage ? (
            <span className="text-[13px] leading-[18px] text-muted-foreground">
                Connect a provider below. Then choose which projects can use it.
            </span>
        ) : null}
    </div>
)

export const OrganizationProvidersPanel = ({
    scope,
    renderRemoveDialog,
    subscriptionDocsUrl,
}: OrganizationProvidersPanelProps) => {
    const access = useAtomValue(organizationConnectionsAccessAtom)
    const query = useAtomValue(organizationSecretsQueryAtom)
    // A member's rows come from the project's vault read, so its state is theirs to show.
    const vault = useAtomValue(vaultSecretsWithOrganizationQueryAtom)
    const managed = useAtomValue(managedOrganizationConnectionsAtom)
    const available = useAtomValue(organizationProviderConnectionsAtom)
    const projectsQuery = useAtomValue(organizationProjectsQueryAtom)
    const deleteSecret = useSetAtom(deleteSecretAtom)
    const refresh = useSetAtom(refreshVaultSecretsAtom)

    const manage = access === "manage"
    // Choosing projects needs every project of the organization: until the list is in, the
    // choice waits as it does for the plan.
    const choosing = manage && scope.projectChoice !== "all"
    const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
    const drawerScope = useMemo<OrganizationConnectionScope>(
        () => ({
            ...scope,
            projects,
            projectChoice: choosing && !projectsQuery.data ? "pending" : scope.projectChoice,
            readOnly: !manage,
        }),
        [scope, projects, choosing, projectsQuery.data, manage],
    )

    const source = useMemo<ProvidersSource>(() => {
        const connections = manage ? managed : available
        const names = new Map(projects.map((project) => [project.id, project.name]))
        return {
            connections,
            rows: manage
                ? connections.filter((connection) => !isSubscriptionConnection(connection))
                : connections,
            loading: access === "loading" || (access === "view" && vault.isPending),
            describe: (connection: ProviderConnection) =>
                isSubscriptionConnection(connection)
                    ? [connection.title, subscriptionStatusLine(connection.subscription)]
                          .filter(Boolean)
                          .join(" · ")
                    : rowDescription(
                          connection,
                          manage ? projectsSummary(connection, names) : null,
                      ),
            // A member's subscription row has no drawer: there is nothing to test.
            canOpen: (connection: ProviderConnection) =>
                manage || !isSubscriptionConnection(connection),
            manage,
            remove: async (connection: ProviderConnection) => {
                await deleteSecret(connection.source)
                message.success(`${connection.name} deleted.`)
                await refresh()
            },
            removeFailed: (failure: unknown, connection: ProviderConnection) =>
                organizationSaveError(failure, scope.name, connection.name) ??
                `Agenta could not remove ${connection.name}. Try again.`,
            catalog: manage ? {notShareable: NOT_SHAREABLE} : undefined,
            subscriptions: manage ? managed : undefined,
            emptyFooter: <EmptyNote manage={manage} />,
            organization: drawerScope,
        }
    }, [
        manage,
        managed,
        available,
        projects,
        access,
        vault.isPending,
        deleteSecret,
        refresh,
        scope.name,
        drawerScope,
    ])

    const memberVaultFailed = access === "view" && vault.isError && !vault.data
    const projectsFailed = choosing && projectsQuery.isError
    if (access === "error" || memberVaultFailed || projectsFailed) {
        return (
            <LoadFailed
                onRetry={() =>
                    void (memberVaultFailed
                        ? vault.refetch()
                        : projectsFailed
                          ? projectsQuery.refetch()
                          : query.refetch())
                }
            />
        )
    }

    return (
        <ProvidersPanel
            source={source}
            renderRemoveDialog={renderRemoveDialog}
            subscriptionDocsUrl={subscriptionDocsUrl}
        />
    )
}
