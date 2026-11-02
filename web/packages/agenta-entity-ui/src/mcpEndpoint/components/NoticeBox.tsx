/**
 * A quiet box for what is about to happen somewhere this dialog does not control.
 *
 * Not an alert: nothing has gone wrong and nothing needs deciding. It carries the sentence
 * that stops the provider's own window from arriving unexplained.
 */
import type {ReactNode} from "react"

import {Key} from "@phosphor-icons/react"

export interface NoticeBoxProps {
    /** Defaults to the key glyph, which is what every current use is about. */
    icon?: ReactNode
    children: ReactNode
    className?: string
}

export const NoticeBox = ({icon, children, className}: NoticeBoxProps) => (
    <div
        data-testid="mcp-notice-box"
        className={`flex items-start gap-2.5 rounded-control border border-solid border-colorBorderSecondary bg-colorBgContainer p-3 ${className ?? ""}`}
    >
        <span className="mt-px shrink-0 text-colorTextSecondary">{icon ?? <Key size={16} />}</span>
        <p className="m-0 text-xs leading-normal text-colorTextSecondary">{children}</p>
    </div>
)

export default NoticeBox
