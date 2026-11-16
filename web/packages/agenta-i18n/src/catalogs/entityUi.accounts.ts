import en from "../../locales/en/entityUi.accounts.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.accounts",
    en,
    (language) => import(`../../locales/${language}/entityUi.accounts.json`),
)
