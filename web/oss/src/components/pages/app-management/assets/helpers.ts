import type {WorkflowCatalogTemplate} from "@agenta/entities/workflow"

import {isDemo} from "@/oss/lib/helpers/utils"

/**
 * Get the template key from a workflow catalog template.
 * The catalog template already has the key directly — no image.title mapping needed.
 */
export const getTemplateKey = (template: WorkflowCatalogTemplate): string | undefined => {
    return template.key
}

export const timeout = isDemo() ? 60000 : 30000
