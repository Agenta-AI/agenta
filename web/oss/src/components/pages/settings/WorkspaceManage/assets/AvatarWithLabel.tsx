import {InitialsAvatar} from "@agenta/ui"

const AvatarWithLabel = ({name}: {name: string | undefined}) => {
    return (
        <div className="flex items-center gap-2">
            <InitialsAvatar size="small" name={name as string} />
            <span>{name}</span>
        </div>
    )
}

export default AvatarWithLabel
