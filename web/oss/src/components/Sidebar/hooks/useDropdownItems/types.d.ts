import {Org, OrgDetails, User} from "@/oss/lib/Types"
import {ProjectsResponse} from "@/oss/services/project/types"

export interface UseDropdownItemsProps {
    user: User | null
    selectedOrg: OrgDetails | null
    orgs: Org[]
    project: ProjectsResponse | null
    logout: () => void
    projects: ProjectsResponse[]
}
