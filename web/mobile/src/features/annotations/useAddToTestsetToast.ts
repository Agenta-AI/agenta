import {useEffect, useRef} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {useDeveloperViewEnabled} from "../developer/developerViewAccess"

/**
 * Says once per export job how many rows reached which testset. The toast links to the testset
 * only while the testsets view is on; otherwise there is nowhere in /m to go.
 */
export const useAddToTestsetToast = (base: string) => {
    const router = useRouter()
    const job = useAtomValue(annotationSessionController.selectors.addToTestsetExportJob())
    const testsetsEnabled = useDeveloperViewEnabled("testsets") === true
    const notifiedJobId = useRef<string | null>(null)

    useEffect(() => {
        if (!job.id || job.status !== "success" || notifiedJobId.current === job.id) return
        notifiedJobId.current = job.id
        const label = job.targetTestsetName ?? "testset"
        const testsetId = job.targetTestsetId
        const link =
            testsetsEnabled && testsetId
                ? {
                      onNavigate: () =>
                          void router.push(`${base}/testsets/${testsetId}`).catch(() => undefined),
                      linkText: `View "${label}"`,
                  }
                : {}
        message.success({
            content: `Added ${job.processed} row${job.processed === 1 ? "" : "s"} to ${label}.`,
            ...link,
            duration: 5,
        })
    }, [job, testsetsEnabled, router, base])
}
