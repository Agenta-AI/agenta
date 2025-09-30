import {Org, OrgDetails, User} from "@/oss/lib/Types"
import {ProjectsResponse} from "@/oss/services/project/types"

export interface UseDropdownItemsProps {
    user: User | null
    selectedOrg: OrgDetails | null
    orgs: Org[]
    project: ProjectsResponse | null
    projects: ProjectsResponse[]
    interactive?: boolean
    logout: () => void
}
