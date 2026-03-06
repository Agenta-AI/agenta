import { buildSubscription } from "./src/components/Automations/utils/buildSubscription";

const openFormValues = { provider: "webhook", url: "http://test", event_types: ["a"], auth_mode: "signature" };
const closedFormValues = { provider: "webhook", url: "http://test", event_types: ["a"] };

console.log("Open payload: ", JSON.stringify(buildSubscription(openFormValues as any, false)));
console.log("Closed payload: ", JSON.stringify(buildSubscription(closedFormValues as any, false)));

