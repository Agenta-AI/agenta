import type {WorkspaceRole} from "@agenta/entities/organization"
import {atom} from "jotai"

export const workspaceRolesAtom = atom<WorkspaceRole[]>([])
