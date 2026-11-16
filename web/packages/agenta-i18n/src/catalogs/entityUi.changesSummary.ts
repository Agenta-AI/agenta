import en from "../../locales/en/entityUi.changesSummary.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.changesSummary",
    en,
    (language) => import(`../../locales/${language}/entityUi.changesSummary.json`),
)
