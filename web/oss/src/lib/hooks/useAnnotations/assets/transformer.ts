import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {WorkspaceMember} from "@/oss/lib/Types"

import {EvaluatorDto} from "../../useEvaluators/types"
import {AnnotationResponseDto} from "../types"

import {groupOutputValues} from "./helpers"

// This is being used in both useAnnotations and useEvaluators
export const transformApiData = <T extends AnnotationResponseDto | EvaluatorDto>({
    data,
    members,
}: {
    data: T
    members: WorkspaceMember[]
}): T => {
    return {
        ...data,
        ...(data.data && "outputs" in data.data
            ? {
                  data: {
                      ...data.data,
                      outputs: groupOutputValues(data.data?.outputs || {}),
                  },
              }
            : {}),
        createdAt: formatDay({date: data.created_at}),
        createdBy:
            members.find((member) => member.user.id === data.created_by_id)?.user.username ||
            data.created_by_id,
        createdById: data.created_by_id,
    }
}
