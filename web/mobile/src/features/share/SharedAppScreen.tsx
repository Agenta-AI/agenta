import {sharedAppQueryFamily, type ShareError} from "@agenta/entities/drive"
import {SharedAppView} from "@agenta/entity-ui/drive"
import {useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"

import {SharedAppHeader} from "./SharedAppHeader"
import {SharedAppError} from "./states/SharedAppError"
import {SharedAppSkeleton} from "./states/SharedAppSkeleton"

/** A shared app under a header that sits outside it and always names the author. */
export const SharedAppScreen = ({token}: {token: string}) => {
    const query = useAtomValue(sharedAppQueryFamily(token))
    const snapshot = query.data

    return (
        <div className="flex h-dvh flex-col bg-background">
            <PageTitle title={snapshot?.name ?? "Shared app"} />
            <SharedAppHeader snapshot={snapshot ?? null} />
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
