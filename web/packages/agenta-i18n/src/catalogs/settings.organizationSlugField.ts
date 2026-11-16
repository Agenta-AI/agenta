import en from "../../locales/en/settings.organizationSlugField.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "settings.organizationSlugField",
    en,
    (language) => import(`../../locales/${language}/settings.organizationSlugField.json`),
)
