import clsx from "clsx"

import useSessionDrawer from "../../hooks/useSessionDrawer"
import SessionContentSummary from "../SessionContentSummary"
import SessionMessagePanel from "../SessionMessagePanel"

const SessionContent = () => {
    const {sessionTraces} = useSessionDrawer()

    return (
        <section className={clsx("h-[89vh] shrink-0 flex flex-col gap-4 p-4 overflow-y-auto")}>
            <SessionContentSummary />

            <div className="w-full flex flex-col gap-4">
                {sessionTraces.map((trace: any, index: number) => {
                    const messages = []
                    const inputs = trace.inputs || trace.attributes?.inputs
                    const outputs = trace.outputs || trace.attributes?.outputs

                    if (inputs) {
                        const content = inputs.message || inputs.input || JSON.stringify(inputs)
                        messages.push({
                            role: "user",
                            content:
                                typeof content === "string" ? content : JSON.stringify(content),
                        })
                    }

                    if (outputs) {
                        const content = outputs.message || outputs.output || JSON.stringify(outputs)
                        messages.push({
                            role: "assistant",
                            content:
                                typeof content === "string" ? content : JSON.stringify(content),
                        })
                    }

                    return (
                        <SessionMessagePanel
                            key={trace.span_id || index}
                            label={`Turn ${index + 1}`}
                            value={messages}
                            trace={trace}
                        />
                    )
                })}
            </div>
        </section>
    )
}

export default SessionContent
