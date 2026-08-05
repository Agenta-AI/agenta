#!/usr/bin/env node
// P3 derisk probe: local HTTP listener standing in for the egress proxy / OpenAI API.
// Logs every request (method, url, headers, first 2KB of body) as JSONL to argv[2],
// listens on argv[1], and answers with an OpenAI-style 401 error body.
import { appendFileSync, writeFileSync } from "node:fs";
import http from "node:http";

const port = Number(process.argv[2] ?? 8977);
const logPath =
  process.argv[3] ??
  "/tmp/codex-derisk/p3-listener.log";
writeFileSync(logPath, "");

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => {
    if (body.length < 2048) body += c.toString("utf8");
  });
  req.on("end", () => {
    appendFileSync(
      logPath,
      JSON.stringify({
        t: new Date().toISOString(),
        method: req.method,
        url: req.url,
        headers: req.headers,
        bodyPrefix: body.slice(0, 2048),
      }) + "\n",
    );
    res.writeHead(401, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        error: {
          message: "Incorrect API key provided (spike listener canned reply).",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      }),
    );
  });
});
server.listen(port, "127.0.0.1", () =>
  console.log(`p3 listener on 127.0.0.1:${port} -> ${logPath}`),
);
