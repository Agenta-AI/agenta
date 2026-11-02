import {AnnotationDto} from "@agenta/entities/annotation/dto"

import {getProfileValues} from "@/oss/state/profile"

export const isAnnotationCreatedByCurrentUser = (annotation: AnnotationDto) => {
    const {user} = getProfileValues()

    return (
        annotation.createdById === user?.data?.id &&
        annotation.channel === "web" &&
        annotation.origin === "human" &&
        annotation.kind === "adhoc"
    )
}
