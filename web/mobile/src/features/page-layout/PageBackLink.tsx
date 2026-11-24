import {BackLink} from "@agenta/ui/ui"
import Link from "next/link"

import type {PageBack} from "./PageBackBar"

/** On an expanded window, an inside page's way up: the kit's back link, 8px over the title. */
export const PageBackLink = ({back}: {back: PageBack}) =>
    back.onBack ? (
        <BackLink onClick={back.onBack} className="mb-2">
            <span className="truncate">{back.label}</span>
        </BackLink>
    ) : (
        <BackLink asChild className="mb-2">
            <Link href={back.href ?? ""}>
                <span className="truncate">{back.label}</span>
            </Link>
        </BackLink>
    )
