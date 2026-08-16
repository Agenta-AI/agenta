import Link from "next/link"

import {INLINE_LINK} from "@/lib/interactive"

/** A titled list band, same voice as the home sections. */
export const AgentOverviewSection = ({
    title,
    viewAllHref,
    children,
}: {
    title: string
    viewAllHref?: string
    children: React.ReactNode
}) => (
    <section className="flex flex-col">
        <div className="flex items-center justify-between px-4 pb-1 pt-4">
            <h2 className="m-0 text-xs font-semibold uppercase tracking-wide">{title}</h2>
            {viewAllHref ? (
                <Link
                    href={viewAllHref}
                    className={`text-muted-foreground text-xs no-underline ${INLINE_LINK}`}
                >
                    View all →
                </Link>
            ) : null}
        </div>
        {children}
    </section>
)
