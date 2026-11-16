import en from "../../locales/en/entityUi.subscriptionSignIn.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "entityUi.subscriptionSignIn",
    en,
    (language) => import(`../../locales/${language}/entityUi.subscriptionSignIn.json`),
)
