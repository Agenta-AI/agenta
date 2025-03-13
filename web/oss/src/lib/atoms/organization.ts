import {atom} from "jotai"

import {WorkspaceRole} from "../Types"

export const workspaceRolesAtom = atom<WorkspaceRole[]>([])
