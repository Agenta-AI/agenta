import {SendOutlined} from "@ant-design/icons"
import {Button, Input, Typography} from "antd"

import {StopButton} from "./StopButton"

export const Composer = ({
    draft,
    setDraft,
    busy,
    stopping,
    send,
    stop,
}: {
    draft: string
    setDraft: (value: string) => void
    busy: boolean
    stopping: boolean
    send: () => void
    stop: () => void
}) => (
    <div className="composer-wrap">
        <div className="composer">
            <Input.TextArea
                aria-label="Message"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault()
                        if (!busy && draft.trim()) send()
                    }
                }}
                autoSize={{minRows: 2, maxRows: 7}}
                placeholder="Ask your agent..."
                disabled={busy}
            />
            <div className="composer-footer">
                <Typography.Text type="secondary">
                    Enter to send · Shift + Enter for a new line
                </Typography.Text>
                {busy ? (
                    <StopButton stopping={stopping} stop={stop} />
                ) : (
                    <Button
                        type="primary"
                        icon={<SendOutlined />}
                        disabled={!draft.trim()}
                        onClick={send}
                    >
                        Send
                    </Button>
                )}
            </div>
        </div>
    </div>
)
