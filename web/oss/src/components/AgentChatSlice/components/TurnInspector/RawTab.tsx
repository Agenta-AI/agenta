import {memo} from "react"

import {type TurnRequestCapture} from "@agenta/playground"
import {App, Button, Typography} from "antd"

const {Text} = Typography

/** One capture's literal outgoing request body, copyable for repro / bug reports. */
const RawTab = ({captures}: {captures: TurnRequestCapture[]}) => {
    const {message} = App.useApp()
    if (captures.length === 0) {
        return <div className="text-xs text-colorTextTertiary">No capture for this turn.</div>
    }
    return (
        <div className="flex flex-col gap-3">
            {captures.map((c, i) => {
                const body = {
                    session_id: c.sessionId,
                    references: c.references,
                    data: {inputs: {messages: c.messages}, parameters: c.parameters},
                }
                const json = JSON.stringify(body, null, 2)
                return (
                    <div
                        key={c.requestId}
                        className="flex flex-col gap-1.5 rounded-lg border border-solid border-colorBorderSecondary p-3"
                    >
                        <div className="flex items-center gap-2">
                            <Text className="!text-xs !font-medium whitespace-nowrap shrink-0">
                                Request {i + 1} of {captures.length}
                            </Text>
                            <Button
                                type="link"
                                className="!ml-auto !shrink-0 !px-0 !text-xs"
                                onClick={() => {
                                    navigator.clipboard?.writeText(json)
                                    message.success("Request body copied")
                                }}
                            >
                                Copy JSON
                            </Button>
                        </div>
                        <Text
                            type="secondary"
                            className="!text-[11px] font-mono truncate"
                            title={c.invocationUrl}
                        >
                            {c.invocationUrl}
                        </Text>
                        <pre className="m-0 max-h-96 overflow-auto whitespace-pre-wrap break-all rounded bg-colorFillTertiary px-2 py-1.5 font-mono text-[11px] leading-snug text-colorTextSecondary">
                            {json}
                        </pre>
                    </div>
                )
            })}
        </div>
    )
}

export default memo(RawTab)
