export function openLinkedDeliverySession({
    closeDrawer,
    navigate,
    sessionId,
    applicationId,
}: {
    closeDrawer: () => void
    navigate: (sessionId: string, applicationId: string) => void
    sessionId: string
    applicationId: string
}) {
    closeDrawer()
    navigate(sessionId, applicationId)
}
