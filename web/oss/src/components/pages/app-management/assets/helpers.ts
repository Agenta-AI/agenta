import {isDemo} from "@/oss/lib/helpers/utils"
import type {Template} from "@/oss/lib/Types"
import {ServiceType} from "@/oss/services/app-selector/api"

export const getTemplateKey = (template: Template) => {
    switch (template.image.title) {
        case "Completion Prompt":
            return ServiceType.Completion
        case "Chat Prompt":
            return ServiceType.Chat
        case "Custom Workflow":
            return ServiceType.Custom
        default:
            return undefined
    }
}

export const timeout = isDemo() ? 60000 : 30000
