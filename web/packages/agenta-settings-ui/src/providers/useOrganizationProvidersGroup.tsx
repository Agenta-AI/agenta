/**
 * AI providers → the organization's group.
 *
 * An organization owner or admin sees every organization connection with who may use it, and
 * connects a provider once for the projects they choose (the drawer's "Who can use it"). Anyone
 * else sees only the connections their project may use, read-only: no row menu, and a locked
 * drawer that keeps Test.
 */
import {useMemo} from "react"

import {organizationLabel} from "@agenta/entities/organization"
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
    organizationRefusal,
    type OrganizationConnectionScope,
} from "@agenta/entity-ui/secretProvider"
import {message} from "@agenta/ui/app-message"
import {useAtomValue, useSetAtom} from "jotai"

import {LoadFailed} from "../shared/LoadFailed"

import type {ProvidersGroup, ProvidersSource} from "./ProvidersPanel"

/**
 * Who may use a connection, in the row's words. Selected projects are named; until every name is
 * known (the project list still loading, or not readable) the row says nothing about them.
 */
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
    return picked.length === ids.length ? picked.join(", ") : null
}

const rowDescription = (connection: ProviderConnection, projects: string | null): string =>
    [connection.title, connection.hasStoredCredential ? "Key saved" : null, projects]
        .filter(Boolean)
        .join(" · ")

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

export interface OrganizationProvidersGroup {
    /** The group, or null while there is nothing to show (a member with no connection). */
    group: ProvidersGroup | null
    /** The scope a new organization connection saves with; set only for a manager. */
    manageScope: OrganizationConnectionScope | null
}

/**
 * The organization's group of the AI providers page: its rows, how they open and save, and the
 * scope the drawer's "Who can use it" saves an organization connection with.
 */
export const useOrganizationProvidersGroup = (
    scope: Omit<OrganizationConnectionScope, "readOnly" | "projects"> | null,
): OrganizationProvidersGroup => {
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
    // choice waits as it does for the plan. Other tiers read the list only to name rows.
    const choosing = manage && scope?.projectChoice === "choose"
    const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data])
    const drawerScope = useMemo<OrganizationConnectionScope | null>(
        () =>
            scope
                ? {
                      ...scope,
                      projects,
                      projectChoice:
                          choosing && !projectsQuery.data ? "pending" : scope.projectChoice,
                      readOnly: !manage,
                  }
                : null,
        [scope, projects, choosing, projectsQuery.data, manage],
    )

    // A failed refetch keeps the cached rows, so the failure line shows beside them.
    const memberVaultFailed = access === "view" && vault.isError
    const projectsFailed = choosing && projectsQuery.isError
    const failed =
        access === "error" || (manage && query.isError) || memberVaultFailed || projectsFailed

    const source = useMemo<ProvidersSource | null>(() => {
        if (!scope || !drawerScope) return null
        const connections = manage ? managed : available
        const names = new Map(projects.map((project) => [project.id, project.name]))
        return {
            connections,
            rows: connections,
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
            // A subscription row opens its sign-in for a manager; a member has nothing to do there.
            canOpen: (connection: ProviderConnection) =>
                manage || !isSubscriptionConnection(connection),
            manage,
            remove: async (connection: ProviderConnection) => {
                await deleteSecret(connection.source)
                message.success(`${connection.name} deleted.`)
                await refresh()
            },
            removeFailed: (failure: unknown, connection: ProviderConnection) =>
                organizationRefusal(failure, scope.name) ??
                `Agenta could not remove ${connection.name}. Try again.`,
            failure: failed ? (
                <LoadFailed
                    message="Couldn't load the organization connections."
                    onRetry={() =>
                        void (memberVaultFailed
                            ? vault.refetch()
                            : projectsFailed
                              ? projectsQuery.refetch()
                              : query.refetch())
                    }
                />
            ) : undefined,
            emptyFooter: manage ? <EmptyNote manage /> : undefined,
            organization: drawerScope,
            // A manager signs the organization in to ChatGPT or Claude here.
            offersSubscriptions: manage,
            onSaved: () => void refresh(),
        }
    }, [
        scope,
        drawerScope,
        manage,
        managed,
        available,
        projects,
        access,
        vault,
        deleteSecret,
        refresh,
        failed,
        memberVaultFailed,
        projectsFailed,
        projectsQuery,
        query,
    ])

    return useMemo(
        () => ({
            group: source
                ? {key: "organization", label: organizationLabel(scope?.name ?? ""), source}
                : null,
            manageScope: manage ? drawerScope : null,
        }),
        [source, scope?.name, manage, drawerScope],
    )
}
