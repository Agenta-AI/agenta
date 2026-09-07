export const isSecretPropagationFailure = (response: Record<string, any> | null): boolean => {
    // A newly recreated fixture connection may precede the service's cached inventory.
    if (
        response?.status?.code === 400 &&
        response.status.type === "https://agenta.ai/docs/misc/errors#v0:schemas:unknown-connection"
    ) {
        return true
    }

    const raw = JSON.stringify(response ?? {}).toLowerCase()
    return raw.includes("invalid-secrets") || raw.includes("no api key found for model")
}
