import en from "../../locales/en/agents.list.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "agents.list",
    en,
    (language) => import(`../../locales/${language}/agents.list.json`),
)
