import type {MenuProps} from "antd"

import {
    Organization as OrganizationRecord,
    OrganizationDetails as OrganizationDetailsRecord,
    User as UserRecord,
} from "@/oss/lib/Types"
import {ProjectsResponse} from "@/oss/services/project/types"

export interface UseDropdownItemsProps {
    user: UserRecord | null
    selectedOrganization: OrganizationDetailsRecord | null
    organizations: OrganizationRecord[]
    project: ProjectsResponse | null
    projects: ProjectsResponse[]
    interactive?: boolean
    logout: () => void
}

export type DropdownItemMeta =
    | {type: "organization"; organizationId: string | null}
    | {
          type: "project"
          workspaceId: string
          projectId: string
          organizationId?: string | null
      }
    | {type: "logout"; action: () => void}

export interface DropdownItemsResult {
    items: MenuProps["items"]
    keyMap: Record<string, DropdownItemMeta>
    selectedKey?: string
    preferredOrganizationKey?: string
}
