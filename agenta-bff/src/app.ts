import buildServer from "./server";

const server = buildServer();

async function main() {
  try {
    await server.listen(3030, "0.0.0.0");

    console.log(`Server ready at http://localhost:3030`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
