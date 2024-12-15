addEventListener(
    "message",
    (
        event: MessageEvent<{
            type: string
            payload: any
        }>,
    ) => {
        if (event.data.type === "ping") {
            postMessage("pong")
        } else {
            postMessage({
                type: "error",
                payload: "Unknown message",
            })
        }
    },
)
