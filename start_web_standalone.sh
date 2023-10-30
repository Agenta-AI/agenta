# Example:-
# for prod: ./start_web_standalone.sh prod
# for dev: ./start_web_standalone.sh dev or ./start_web_standalone.sh

env="dev"

# set the env value if it is passed in as a cli argument
if [[ ! -z $1 ]]; then 
    env="$1"
fi

# install dependencies for agenta-web
cd agenta-web
if [ ! -d "node_modules" ]; then
    npm install
fi
cd ..

if [[ $env == "prod" ]]; then
    echo "Running in prod mode"

    # run docker compose for prod excluding agenta-web
    docker compose -f "docker-compose.prod.yml" up -d --build --scale agenta-web=0

    # run next js app in prod mode
    cd agenta-web
    npm run build
    npm run start
else
    echo "Running in dev mode"

    # run docker compose for dev excluding agenta-web
    docker compose -f "docker-compose.yml" up -d --build --scale agenta-web=0

    # run next js app in dev mode
    cd agenta-web
    npm run dev
fi