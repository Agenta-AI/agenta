import {useCallback} from "react"
import useWebWorker, {type WorkerMessage} from "../"

const WorkerExampleComponent = () => {
    const {postMessageToWorker, workerStatus, createWorkerMessage} = useWebWorker<{
        payload: any
    }>(
        useCallback((message: WorkerMessage) => {
            console.log("Message from worker:", message)
        }, []),
    )

    const handleClick = useCallback(() => {
        postMessageToWorker(
            createWorkerMessage("ping", {
                payload: null,
            }),
        )
    }, [postMessageToWorker])
}

export default WorkerExampleComponent
