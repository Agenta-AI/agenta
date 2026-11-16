import en from "../../locales/en/skills.list.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "skills.list",
    en,
    (language) => import(`../../locales/${language}/skills.list.json`),
)
