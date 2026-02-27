import {defineExtension} from "lexical"

import {registerPropertyClickBehavior} from "../plugins/PropertyClickPlugin"

interface PropertyClickConfig {
    onPropertyClick: ((path: string) => void) | null
    language: string
}

export const PropertyClickExtension = defineExtension({
    name: "@agenta/editor/code/PropertyClick",
    config: {
        onPropertyClick: null,
        language: "json",
    } as PropertyClickConfig,
    register: (editor, config) => {
        return registerPropertyClickBehavior(editor, {
            onPropertyClick: config.onPropertyClick ?? undefined,
            language: config.language,
        })
    },
})
