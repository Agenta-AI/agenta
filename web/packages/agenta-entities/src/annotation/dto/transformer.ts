import {formatDay} from "@agenta/shared/utils/dateTime"

import type {WorkspaceMember} from "../../organization"

import {groupOutputValues} from "./helpers"

/**
 * Structural constraint covering both `AnnotationResponseDto` and the OSS
 * `EvaluatorDto` — the transform only reads these three fields, so the package
 * does not need to depend on either concrete type.
 */
export interface TransformableApiRecord {
    data?: unknown
    created_at?: string
    created_by_id?: string
}

// This is being used in both useAnnotations and useEvaluators
export const transformApiData = <T extends TransformableApiRecord>({
    data,
    members,
}: {
    data: T
    members: WorkspaceMember[]
}): T => {
    const outputs =
        data.data && typeof data.data === "object" && "outputs" in data.data
            ? (data.data as {outputs?: Record<string, unknown>}).outputs
            : undefined

    return {
        ...data,
        ...(data.data && typeof data.data === "object" && "outputs" in data.data
            ? {
                  data: {
                      ...data.data,
                      outputs: groupOutputValues(outputs || {}),
                  },
              }
            : {}),
        createdAt: formatDay({date: data.created_at}),
        createdBy:
            members.find((member) => member.user.id === data.created_by_id)?.user.username ||
            data.created_by_id,
        createdById: data.created_by_id,
    } as T
}
