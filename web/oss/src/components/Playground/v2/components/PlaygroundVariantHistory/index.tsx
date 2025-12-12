import {useMemo} from "react"

import {Menu} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import PlaygroundVariantConfigPrompt from "@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"
import {variantsByIdAtom} from "@/oss/components/Playground/state/atoms"

import PlaygroundPromptToolsConfig from "../PlaygroundPromptToolsConfig"

import PlaygroundVariantHistoryHeader from "./assets/PlaygroundVariantHistoryHeader"
import {useStyles} from "./styles"
import {PlaygroundVariantHistoryProps} from "./types"

const PlaygroundVariantHistory: React.FC<PlaygroundVariantHistoryProps> = ({variantId}) => {
    const variants = useAtomValue(variantsByIdAtom)
    const promptIds = useMemo(() => {
        const variant = variants[variantId]
        if (!variant) return []
        return (variant?.prompts || [])?.map((prompt) => prompt.__id) ?? []
    }, [variants, variantId])
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
                            disableCollapse={promptIds.length === 1}
                        />
                    ))}

                    <PlaygroundPromptToolsConfig />
                </main>
            </section>
        </>
    )
}

export default PlaygroundVariantHistory
