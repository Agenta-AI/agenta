import {useCallback, useState} from "react"

import {
    type OrganizationSecretProjects,
    createOrganizationSubscriptionConnectionAtom,
    createSubscriptionConnectionAtom,
    refreshVaultSecretsAtom,
    setOrganizationSubscriptionTokenAtom,
    setSubscriptionTokenAtom,
    subscriptionIsReady,
    subscriptionProviderName,
    subscriptionTokenErrorText,
    type ProviderConnection,
} from "@agenta/entities/secret"
import {extractApiErrorMessage} from "@agenta/shared/utils"
import {useSetAtom} from "jotai"

/** Every `claude setup-token` value starts with this. */
const SETUP_TOKEN_PREFIX = "sk-ant-oat"

/** A pasted token: create the connection if needed, store the token, reuse the row on retry. */
export const useSubscriptionToken = ({
    provider,
    connection = null,
    scope = "project",
    projects,
}: {
    provider: string
    connection?: ProviderConnection | null
    /** `organization` creates and stores an organization connection. */
    scope?: "project" | "organization"
    /** Who may use a new organization connection; every project when absent (Q1). */
    projects?: OrganizationSecretProjects
}) => {
    const createProjectConnection = useSetAtom(createSubscriptionConnectionAtom)
    const createOrganizationConnection = useSetAtom(createOrganizationSubscriptionConnectionAtom)
    const setProjectToken = useSetAtom(setSubscriptionTokenAtom)
    const setOrganizationToken = useSetAtom(setOrganizationSubscriptionTokenAtom)
    const organization = scope === "organization"
    const createConnection = useCallback(
        (args: {provider: string; name: string}) =>
            organization
                ? createOrganizationConnection({
                      ...args,
                      // The API's default name says whose it is: "Claude (Organization)".
                      name: "",
                      projects: projects ?? {availability: "all_projects", projectIds: []},
                  })
                : createProjectConnection(args),
        [createOrganizationConnection, createProjectConnection, organization, projects],
    )
    const setToken = organization ? setOrganizationToken : setProjectToken
    const refreshVault = useSetAtom(refreshVaultSecretsAtom)

    const [value, setValue] = useState("")
    const [checking, setChecking] = useState(false)
    const [error, setError] = useState<string | null>(null)
    // A connection this hook created, until a stored token makes the vault list it.
    const [createdId, setCreatedId] = useState<string | null>(null)
    const [replacing, setReplacing] = useState(false)

    const name = connection?.name || subscriptionProviderName(provider)
    // A failed replacement keeps the old token, so the steps stay open on its error.
    const connected = subscriptionIsReady(connection?.subscription) && !replacing
    const token = value.trim()
    const canSubmit = token.startsWith(SETUP_TOKEN_PREFIX) && !checking

    const submit = useCallback(async () => {
        if (!canSubmit) return
        setChecking(true)
        setError(null)
        let created = false
        try {
            let secretId = connection?.id ?? createdId
            if (!secretId) {
                secretId = await createConnection({provider, name})
                setCreatedId(secretId)
                created = true
            }
            // Resolves once the vault refetch reports the connection ready.
            await setToken({secretId, token})
            setCreatedId(null)
            setReplacing(false)
            setValue("")
        } catch (caught) {
            // So a refused token still leaves the row where the next surface finds it.
            if (created) void refreshVault()
            setError(
                subscriptionTokenErrorText(caught) ||
                    extractApiErrorMessage(caught) ||
                    "Agenta could not store this token. Try again.",
            )
        } finally {
            setChecking(false)
        }
    }, [
        canSubmit,
        connection?.id,
        createConnection,
        createdId,
        name,
        provider,
        refreshVault,
        setToken,
        token,
    ])

    const onChange = useCallback((next: string) => {
        setValue(next)
        setError(null)
    }, [])

    /** Open the steps on a connected connection. The old token stays until a new one is stored. */
    const replace = useCallback(() => {
        setValue("")
        setError(null)
        setReplacing(true)
    }, [])

    /** Close the steps without storing anything. */
    const reset = useCallback(() => {
        setValue("")
        setError(null)
        setReplacing(false)
    }, [])

    return {name, value, onChange, canSubmit, checking, error, connected, submit, replace, reset}
}

export type SubscriptionTokenState = ReturnType<typeof useSubscriptionToken>
