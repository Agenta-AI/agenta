export const isComposerRunStoppable = ({
    localStreaming,
    serverBusy,
    waitingOnUser,
}: {
    localStreaming: boolean
    serverBusy: boolean
    waitingOnUser: boolean
}): boolean => (localStreaming || serverBusy) && !waitingOnUser
