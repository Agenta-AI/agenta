import ChatMarkdown from "@agenta/chat/markdown"
import type {DriveMarkdownProps} from "@agenta/entity-ui/drive"

import {proseClassName, useDriveLinkResolver} from "./AssistantMarkdown"

/**
 * The Files pane's markdown renderer on `/m` — the chat's own `ChatMarkdown` with the same prose
 * scale, so a rendered `.md` in the drive reads like the assistant's prose. Registered once in
 * `_app` through `registerDriveMarkdown` (the package takes it by injection).
 */
export const DriveMarkdownRenderer = ({content, className}: DriveMarkdownProps) => (
    <ChatMarkdown
        content={content}
        baseClassName={proseClassName}
        className={className}
        useLinkResolver={useDriveLinkResolver}
    />
)
