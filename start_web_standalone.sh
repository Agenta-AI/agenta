# Example:-
# for prod: ./start_web_standalone.sh prod or ./start_web_standalone.sh prod demo
# for dev: ./start_web_standalone.sh or ./start_web_standalone.sh dev demo

env="dev"
suffix=""

# set the env value if it is passed in as a cli argument
if [[ ! -z $1 ]]; then 
    env="$1"
fi

# set the suffix value based on variant and env value
if [[ ! -z $2 ]]; then 
    suffix="${2}.${env}."
elif [[ $env == "prod" ]]; then
    suffix="${env}."
fi

# install dependencies for agenta-web
cd agenta-web
if [ ! -d "node_modules" ]; then
    npm install
fi
cd ..

echo "Running in ${env} mode"
compose_file="docker-compose.${suffix}yml"
echo "compose_file: $compose_file"

# run docker compose without agenta-web service
docker compose -f $compose_file up -d --build --scale agenta-web=0

if [[ $env == "prod" ]]; then
    # run next js app in prod mode
    cd agenta-web
    npm run build
    npm run start
else
    # run next js app in dev mode
    cd agenta-web
    npm run dev
fi