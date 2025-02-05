import {Org, OrgDetails, User} from "@/lib/Types"
import {ProjectsResponse} from "@/services/project/types"

export type UseDropdownItemsProps = {
    user: User | null
    selectedOrg: OrgDetails | null
    orgs: Org[]
    project: ProjectsResponse | null
    logout: () => void
}
