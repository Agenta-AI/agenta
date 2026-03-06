import { buildSubscription } from "./src/components/Automations/utils/buildSubscription";
import { AUTOMATION_SCHEMA } from "./src/components/Automations/constants";

const formValues = {
    provider: "webhook",
    events: ["environments.revisions.committed"],
    name: "Test",
    url: "https://example.com"
};

const payload = buildSubscription(formValues as any, false);
console.log(JSON.stringify(payload, null, 2));
