# Example:-
# ./start_web_standalone.sh docker-compose.yml
# ./start_web_standalone.sh docker-compose.demo.yml
# ./start_web_standalone.sh docker-compose.demo.prod.yml

# Check if a dockerfile is provided as an argument
if [[ -z $1 ]]; then
    echo "Please provide a docker-compose file as an argument."
    exit 1
fi

compose_file="$1"

# Extract the parts of the filename
IFS='.' read -r -a parts <<< "$compose_file"

# install dependencies for agenta-web
cd agenta-web
if [ ! -d "node_modules" ]; then
    npm install
fi
cd ..

echo "Using docker-compose file: $compose_file"

# run docker compose without agenta-web service
export NEXT_PUBLIC_STANDALONE="true"
docker compose -f $compose_file down
docker compose -f $compose_file up -d --build --scale agenta-web=0 

# Check if the last part is 'prod'
if [[ "${parts[@]: -1}" == "prod" ]]; then
    echo "Running in production mode"
    # run next js app in prod mode
    cd agenta-web
    npm run build
    npm run start
else
    echo "Running in development mode"
    # run next js app in dev mode
    cd agenta-web
    npm run dev
fi