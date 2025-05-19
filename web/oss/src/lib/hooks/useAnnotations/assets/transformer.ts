import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import {WorkspaceMember} from "@/oss/lib/Types"

import {AnnotationDto} from "../types"

import {groupOutputValues} from "./helpers"

export const annotationsTransformer = (annotations: AnnotationDto, members: WorkspaceMember[]) => {
    return {
        ...annotations,
        data: {
            ...annotations.data,
            outputs: groupOutputValues(annotations.data?.outputs || {}),
        },
        created_at: formatDay({date: annotations.created_at}),
        created_by_id:
            members.find((member) => member.user.id === annotations.created_by_id)?.user.username ||
            annotations.created_by_id,
    }
}
