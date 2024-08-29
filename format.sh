cd agenta-web
npx prettier  --write .
cd ../agenta-backend
black .
cd ../agenta-cli
black .
cd ../examples
black .