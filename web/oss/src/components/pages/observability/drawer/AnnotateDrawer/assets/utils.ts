import {getProfileValues} from "@/oss/contexts/profile.context"
import {AnnotationDto} from "@/oss/lib/hooks/useAnnotations/types"

export const isAnnotationCreatedByCurrentUser = (annotation: AnnotationDto) => {
    const {user} = getProfileValues()

    return (
        annotation.createdById === user?.id &&
        annotation.channel === "web" &&
        annotation.origin === "human" &&
        annotation.kind === "adhoc"
    )
}
