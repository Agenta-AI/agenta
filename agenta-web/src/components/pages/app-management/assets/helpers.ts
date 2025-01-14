import {isDemo} from "@/lib/helpers/utils"
import type {Template} from "@/lib/Types"
import {ServiceType} from "@/services/app-selector/api"

export const getTemplateKey = (template: Template) => {
    switch (template.image.title) {
        case "Completion Prompt":
            return ServiceType.Completion
        case "Chat Prompt":
            return ServiceType.Chat
        default:
            return undefined
    }
}

export const timeout = isDemo() ? 60000 : 30000
