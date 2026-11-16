import en from "../../locales/en/entityUi.providerCredentials.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.providerCredentials",
    en,
    (language) => import(`../../locales/${language}/entityUi.providerCredentials.json`),
)
