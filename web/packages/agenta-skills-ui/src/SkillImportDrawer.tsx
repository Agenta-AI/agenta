/** Import skills from a repo: the new skill view, opened on its import step. Hosts keep their props. */
import {SkillCreateDrawer} from "./SkillCreateDrawer"

export interface SkillImportDrawerProps {
    open: boolean
    onClose: () => void
    /** The project is read from the app state; kept so hosts do not change. */
    projectId?: string
}

export function SkillImportDrawer({open, onClose}: SkillImportDrawerProps) {
    return <SkillCreateDrawer open={open} onClose={onClose} start="import" />
}
