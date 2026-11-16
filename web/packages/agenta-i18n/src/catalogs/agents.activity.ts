import en from "../../locales/en/agents.activity.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "agents.activity",
    en,
    (language) => import(`../../locales/${language}/agents.activity.json`),
)
