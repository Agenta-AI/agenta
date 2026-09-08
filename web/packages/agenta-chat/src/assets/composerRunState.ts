export const isComposerRunStoppable = ({
    localStreaming,
    serverBusy,
    serverControlEnabled,
    waitingOnUser,
}: {
    localStreaming: boolean
    serverBusy: boolean
    serverControlEnabled: boolean
    waitingOnUser: boolean
}): boolean => (localStreaming || (serverBusy && serverControlEnabled)) && !waitingOnUser
