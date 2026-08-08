import type {SessionRowVm} from "@agenta/sessions/row"
import Link from "next/link"

/**
 * A home-card row over the shared view-model: the same title/status/preview rules as every
 * other surface, in mobile's list voice.
 */
export const HomeSessionRow = ({vm, href}: {vm: SessionRowVm; href: string}) => (
    <Link href={href} className="border-border flex flex-col gap-1 border-b px-4 py-3">
        <span className="flex min-w-0 items-center gap-2">
            <span
                aria-label={vm.status.label}
                className={`size-2 shrink-0 rounded-full ${vm.status.dotClassName} ${
                    vm.status.pulse ? "motion-safe:animate-pulse" : ""
                }`}
            />
            <span className="truncate text-xs font-medium">{vm.title}</span>
            {vm.status.chipLabel ? (
                <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] leading-none ${vm.status.chipClassName ?? ""}`}
                >
                    {vm.status.chipLabel}
                </span>
            ) : null}
        </span>
        {vm.subtitle ? (
            <span className="text-muted-foreground truncate text-xs">{vm.subtitle}</span>
        ) : null}
    </Link>
)
