// Stands in for controller.cjs in lifecycle tests: listens on a free port and reports it.
const http = require("node:http");
const server = http.createServer((req, res) => {
  const ok =
    req.headers["x-agenta-browser-token"] === process.env.AGENTA_BROWSER_TOKEN;
  res.writeHead(ok ? 200 : 401, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok }));
});
process.on("disconnect", () => process.exit(0));
server.listen(0, "127.0.0.1", () =>
  process.send({ port: server.address().port }),
);
