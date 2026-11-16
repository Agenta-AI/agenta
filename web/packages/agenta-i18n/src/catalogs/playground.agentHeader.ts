import en from "../../locales/en/playground.agentHeader.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "playground.agentHeader",
    en,
    (language) => import(`../../locales/${language}/playground.agentHeader.json`),
)
