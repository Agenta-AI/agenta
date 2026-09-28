import {type SharedAppSnapshot} from "@agenta/entities/drive"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {CaretDown} from "@phosphor-icons/react"
import {useRouter} from "next/router"

/** For an editor: open any version of the share. The link itself always shows the latest. */
export const SharedAppVersionMenu = ({
    snapshot,
    token,
}: {
    snapshot: SharedAppSnapshot
    token: string
}) => {
    const router = useRouter()
    const open = (version: number) =>
        void router.push(
            version === snapshot.latest
                ? `/share/${encodeURIComponent(token)}`
                : `/share/${encodeURIComponent(token)}?v=${version}`,
        )

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1">
                    v{snapshot.version}
                    {snapshot.version === snapshot.latest ? " · latest" : ""}
                    <CaretDown weight="bold" className="size-3 opacity-70" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[140px]">
                {[...snapshot.versions].reverse().map((version) => (
                    <DropdownMenuItem key={version} onSelect={() => open(version)}>
                        v{version}
                        {version === snapshot.latest ? " · latest" : ""}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
