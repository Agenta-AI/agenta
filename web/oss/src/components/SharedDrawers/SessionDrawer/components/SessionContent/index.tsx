import {Typography} from "antd"
import clsx from "clsx"

import useSessionDrawer from "../../hooks/useSessionDrawer"
import SessionContentSummary from "../SessionContentSummary"
import SessionMessagePanel from "../SessionMessagePanel"

import {SessionContentProps} from "./types"

const SessionContent = ({}: SessionContentProps) => {
    const {activeSession} = useSessionDrawer()
    console.log("activeSession", activeSession)
    return (
        <section className={clsx("h-[89vh] shrink-0 flex flex-col gap-4 p-4 overflow-y-auto")}>
            <SessionContentSummary />

            <div className="w-full flex flex-col gap-4">
                {activeSession?.turns.map((turn) => {
                    const messages = []

                    if (turn.user_message?.content) {
                        messages.push({
                            ...turn.user_message,
                            role: "user",
                        })
                    }

                    if (turn.assistant_message?.content) {
                        messages.push({
                            ...turn.assistant_message,
                            role: "assistant",
                        })
                    }

                    return (
                        <SessionMessagePanel
                            key={turn.turn_index}
                            label={`Turn ${turn.turn_index}`}
                            value={messages}
                            trace={turn.trace}
                        />
                    )
                })}
            </div>
        </section>
    )
}

export default SessionContent
