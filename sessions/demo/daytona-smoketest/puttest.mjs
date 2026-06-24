// Isolate: does a raw S3 PUT through the ngrok tunnel work from a Daytona sandbox?
// No geesefs — just the AWS CLI doing GET (list) then PUT, with timing.
import { Daytona } from "@daytonaio/sdk";
const TUNNEL = process.env.TUNNEL;
const daytona = new Daytona({ apiKey: process.env.DAYTONA_API_KEY });
async function exec(sbx, cmd, t = 90) {
  const r = await sbx.process.executeCommand(cmd, undefined, undefined, t);
  console.log(`$ ${cmd.slice(0, 90)}\n  exit=${r.exitCode}: ${String(r.result || "").slice(0, 250)}`);
  return r;
}
const sbx = await daytona.create({ image: "debian:12.9" }, { timeout: 180 });
console.log("sandbox:", sbx.id);
try {
  await exec(sbx, "apt-get update -qq && apt-get install -y -qq awscli curl >/dev/null 2>&1; echo ok", 180);
  const env = "AWS_ACCESS_KEY_ID=demo AWS_SECRET_ACCESS_KEY=demosecret AWS_DEFAULT_REGION=us-east-1";
  // GET path: list bucket (this is what 'mount' exercises — known to work)
  await exec(sbx, `${env} aws --endpoint-url ${TUNNEL} s3 ls s3://demo/ && echo LIST_OK`);
  // PUT path: upload a tiny object (this is what 'write' exercises)
  await exec(sbx, "echo 'raw put through tunnel' > /tmp/put.txt");
  await exec(sbx, `${env} aws --endpoint-url ${TUNNEL} s3 cp /tmp/put.txt s3://demo/daytona-write/raw-put.txt && echo PUT_OK`, 60);
} finally {
  await daytona.delete(sbx);
  console.log("deleted");
}
