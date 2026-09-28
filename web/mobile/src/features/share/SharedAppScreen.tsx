import {sharedAppQueryFamily, type ShareError} from "@agenta/entities/drive"
import {SharedAppView} from "@agenta/entity-ui/drive"
import {useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"

import {SharedAppHeader} from "./SharedAppHeader"
import {SharedAppError} from "./states/SharedAppError"
import {SharedAppSkeleton} from "./states/SharedAppSkeleton"

/**
 * A shared app: the header outside the app, the app under its strict policy below. The header
 * always names the author, so a page inside the app cannot pass itself off as Agenta.
 */
export const SharedAppScreen = ({token, version}: {token: string; version: number | null}) => {
    const query = useAtomValue(sharedAppQueryFamily({token, version}))
    const snapshot = query.data

    return (
        <div className="flex h-dvh flex-col bg-background">
            <PageTitle title={snapshot?.name ?? "Shared app"} />
            <SharedAppHeader snapshot={snapshot ?? null} token={token} />
            <main className="flex min-h-0 flex-1 flex-col">
                {query.isPending ? (
                    <SharedAppSkeleton />
                ) : snapshot ? (
                    <SharedAppView snapshot={snapshot} className="h-full" />
                ) : (
                    <SharedAppError
                        error={query.error as ShareError | null}
                        onRetry={() => void query.refetch()}
                    />
                )}
            </main>
        </div>
    )
}
