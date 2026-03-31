import {useCallback, useMemo} from "react"

import {runnableBridge} from "@agenta/entities/runnable"
import {SharedEditor} from "@agenta/ui/shared-editor"
import {useAtomValue, useSetAtom} from "jotai"

import {getYamlOrJson} from "@/oss/lib/helpers/utils"

export const NewVariantParametersView = ({
    revisionId,
    showOriginal,
}: {
    revisionId: string
    showOriginal?: boolean
}) => {
    const config = useAtomValue(runnableBridge.configuration(revisionId))
    const serverConfig = useAtomValue(runnableBridge.serverConfiguration(revisionId))
    const update = useSetAtom(runnableBridge.update)

    const configJsonString = useMemo(() => {
        const effectiveConfig = showOriginal ? (serverConfig ?? config) : (config ?? serverConfig)
        return getYamlOrJson("JSON", effectiveConfig ?? {})
    }, [config, serverConfig, showOriginal])

    const onChange = useCallback(
        (value: string) => {
            if (showOriginal) return
            if (!value) return

            try {
                const parsed = JSON.parse(value || "{}")
                update(revisionId, parsed)
            } catch (error) {
                // Ignore parse errors; editor will keep showing the current text
            }
        },
        [showOriginal, revisionId, update],
    )

    if (!revisionId) return null

    return (
        <div className="w-full h-full self-stretch grow">
            <SharedEditor
                key={`${revisionId}-${showOriginal ? "original" : "draft"}`}
                editorProps={{
                    codeOnly: true,
                    validationSchema: {
                        type: "object",
                        properties: {},
                    },
                }}
                editorType="border"
                initialValue={configJsonString}
                handleChange={onChange}
                disabled={!!showOriginal}
                state={showOriginal ? "readOnly" : "filled"}
                className="!w-[97%] *:font-mono"
            />
        </div>
    )
}
