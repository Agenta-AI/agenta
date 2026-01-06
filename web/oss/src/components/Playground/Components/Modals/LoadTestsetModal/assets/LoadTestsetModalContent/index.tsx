import {memo, useCallback} from "react"

import {Divider, Spin} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {testset} from "@/oss/state/entities/testset"
import {projectIdAtom} from "@/oss/state/project/selectors/project"
import {urlAtom} from "@/oss/state/url"

import {isCreatingNewTestsetAtom} from "../../atoms/modalState"
import {CreateTestsetCard} from "../../components/CreateTestsetCard"
import {TestsetListSidebar} from "../../components/TestsetListSidebar"
import {TestsetPreviewPanel} from "../../components/TestsetPreviewPanel"
import {LoadTestsetModalContentProps} from "../types"

const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {
        ssr: false,
    },
)

const LoadTestsetModalContent = ({modalProps}: LoadTestsetModalContentProps) => {
    const projectId = useAtomValue(projectIdAtom)
    const isCreatingNew = useAtomValue(isCreatingNewTestsetAtom)
    const router = useRouter()
    const urlState = useAtomValue(urlAtom)

    // Use testset controller API
    const testsetsQuery = useAtomValue(testset.queries.list(null))
    const testsets = testsetsQuery.data?.testsets ?? []
    const isLoadingTestsets = testsetsQuery.isLoading

    const handleCreateTestset = useCallback(() => {
        router.push(`${urlState.projectURL}/testsets`)
    }, [router, urlState?.projectURL])

    if (!projectId) {
        return (
            <div className="flex items-center justify-center py-6">
                <Spin />
            </div>
        )
    }

    if (!testsets.length && !isLoadingTestsets && !isCreatingNew) {
        return (
            <NoResultsFound
                primaryActionLabel="Create new testset"
                onPrimaryAction={handleCreateTestset}
            />
        )
    }

    return (
        <div className="w-full flex flex-col h-full min-h-0 overflow-hidden">
            <section className="flex grow gap-4 min-h-0 overflow-hidden">
                <div className="flex flex-col gap-4 w-[280px] min-w-[280px] max-w-[280px] min-h-0 h-full overflow-hidden">
                    {!isCreatingNew ? (
                        <div className="flex flex-col gap-4 flex-1 min-h-0 overflow-hidden grow">
                            <TestsetListSidebar
                                modalOpen={modalProps.open ?? false}
                                isCreatingNew={isCreatingNew}
                            />
                        </div>
                    ) : null}

                    <div
                        className={clsx("flex flex-col gap-3", {
                            grow: isCreatingNew,
                        })}
                    >
                        <CreateTestsetCard onTestsetCreated={testset.invalidate.list} />
                    </div>
                </div>

                <Divider orientation="vertical" className="m-0 h-full" />

                <div className="w-full h-full flex flex-col gap-4 grow min-h-0 overflow-hidden">
                    <TestsetPreviewPanel />
                </div>
            </section>
        </div>
    )
}

export default memo(LoadTestsetModalContent)
