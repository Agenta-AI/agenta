import {Menu} from "antd"
import {useStyles} from "./styles"
import clsx from "clsx"
import {PlaygroundVariantHistoryProps} from "./types"
import PlaygroundVariantHistoryHeader from "./assets/PlaygroundVariantHistoryHeader"
import PlaygroundPromptToolsConfig from "../PlaygroundPromptToolsConfig"
import {useCallback} from "react"
import PlaygroundVariantConfigPrompt from "@/components/NewPlayground/Components/PlaygroundVariantConfigPrompt"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"

const PlaygroundVariantHistory: React.FC<PlaygroundVariantHistoryProps> = ({variantId}) => {
    const {promptIds = []} = usePlayground({
        variantId,
        hookId: "PlaygroundVariantHistory",
        variantSelector: useCallback((variant: EnhancedVariant) => {
            const promptIds = (variant?.prompts || [])?.map((prompt) => prompt.__id) ?? []
            return {promptIds}
        }, []),
    })
    const classes = useStyles()
    const lintOfRevisions = ["2", "3", "5", "6", "7"]
    const selectedRevision = "5"

    return (
        <>
            <PlaygroundVariantHistoryHeader selectedRevision={selectedRevision} />

            <section className="h-[94%] flex justify-between gap-2">
                <div className={clsx("pt-4 pl-2", classes.menuContainer)}>
                    <Menu
                        items={lintOfRevisions.map((revision) => ({
                            key: revision,
                            label: revision,
                        }))}
                        defaultSelectedKeys={[selectedRevision]}
                        className={clsx("w-[180px]", classes.menu)}
                    />
                </div>

                <main className="w-full p-1 pr-4">
                    {promptIds.map((promptId) => (
                        <PlaygroundVariantConfigPrompt
                            key={promptId as string}
                            promptId={promptId}
                            variantId={variantId}
                        />
                    ))}

                    <PlaygroundPromptToolsConfig />
                </main>
            </section>
        </>
    )
}

export default PlaygroundVariantHistory
