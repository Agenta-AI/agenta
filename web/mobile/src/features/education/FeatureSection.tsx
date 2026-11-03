import type {ReactNode} from "react"

import {ArrowRight} from "@phosphor-icons/react"
import Link from "next/link"

/** An onboarding section: a title, a hint or "view all" link on the right, then its cards. */
export const FeatureSection = ({
    title,
    hint,
    link,
    children,
}: {
    title: string
    hint?: string
    link?: {href: string; label: string}
    children: ReactNode
}) => (
    <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-[14px] font-semibold text-foreground">{title}</h2>
            {link ? (
                <Link
                    href={link.href}
                    className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground no-underline hover:text-foreground"
                >
                    {link.label}
                    <ArrowRight className="size-3" aria-hidden />
                </Link>
            ) : hint ? (
                <span className="text-[12.5px] text-colorTextTertiary @max-xl:hidden">{hint}</span>
            ) : null}
        </div>
        {children}
    </section>
)
