import {ArrowLeftIcon} from "@phosphor-icons/react"
import Link from "next/link"

import type {PageBack} from "./PageBackBar"

const LINK =
    "-ml-1.5 mb-2 inline-flex h-control-sm cursor-pointer items-center gap-1.5 rounded-md border-0 bg-transparent px-1.5 text-label text-muted-foreground no-underline hover:bg-accent hover:text-foreground focus-ring"

/** On an expanded window, an inside page's way up: a quiet link over the title. */
export const PageBackLink = ({back}: {back: PageBack}) =>
    back.onBack ? (
        <button type="button" onClick={back.onBack} className={LINK}>
            <ArrowLeftIcon aria-hidden className="size-4 shrink-0" />
            {back.label}
        </button>
    ) : (
        <Link href={back.href ?? ""} className={LINK}>
            <ArrowLeftIcon aria-hidden className="size-4 shrink-0" />
            {back.label}
        </Link>
    )
