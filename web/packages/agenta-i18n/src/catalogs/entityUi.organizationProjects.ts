import en from "../../locales/en/entityUi.organizationProjects.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.organizationProjects",
    en,
    (language) => import(`../../locales/${language}/entityUi.organizationProjects.json`),
)
