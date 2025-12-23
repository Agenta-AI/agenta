import clsx from "clsx"

import {extractTraceData} from "../../assets/utils"
import useSessionDrawer from "../../hooks/useSessionDrawer"
import SessionContentSummary from "../SessionContentSummary"
import SessionMessagePanel from "../SessionMessagePanel"

const SessionContent = () => {
    const {sessionTraces} = useSessionDrawer()

    return (
        <section className={clsx("h-[89vh] shrink-0 flex flex-col gap-4 p-4 overflow-y-auto")}>
            <SessionContentSummary />

            <div className="w-full flex flex-col gap-4">
                {[...sessionTraces]
                    .sort((a: any, b: any) => {
                        const timeA = new Date(a.start_time).getTime()
                        const timeB = new Date(b.start_time).getTime()
                        return timeA - timeB
                    })
                    .map((trace: any, index: number) => {
                        const messages = extractTraceData(trace)

                        return (
                            <div id={trace.span_id} key={trace.span_id || index}>
                                <SessionMessagePanel
                                    label={`Trace ${index + 1}`}
                                    value={messages}
                                    trace={trace}
                                />
                            </div>
                        )
                    })}
            </div>
        </section>
    )
}

export default SessionContent
