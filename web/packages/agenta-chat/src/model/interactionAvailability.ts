export const getInteractionAvailability = ({
    stopped,
    stopping,
    streaming,
}: {
    stopped: boolean
    stopping: boolean
    streaming: boolean
}) => {
    const active = !stopped && !stopping
    return {approvals: active, parkedDocks: active && !streaming}
}
