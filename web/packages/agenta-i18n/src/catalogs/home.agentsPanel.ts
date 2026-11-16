import en from "../../locales/en/home.agentsPanel.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "home.agentsPanel",
    en,
    (language) => import(`../../locales/${language}/home.agentsPanel.json`),
)
