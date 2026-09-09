import {type ReactNode} from "react"

import {chatFileResolver, decodeDriveHref} from "@agenta/entity-ui/drive"

/** A markdown link to a path, not to the web: opens the file in the Files pane (#6659). */
export const DriveLink = ({href, children}: {href: string; children?: ReactNode}) => (
    <>{chatFileResolver.renderCode(decodeDriveHref(href), <>{children}</>)}</>
)
