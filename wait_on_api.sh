#!/bin/sh
delay=2

if [[ ! -z $3 ]]; then 
    delay=$3
fi

while true; do
    url="http://localhost/api/$1"
    echo "Calling API URL: $url"
    response=$(curl -s $url -H "Accept: application/json" -H "Content-Type: application/json")
    startsWith="$2*"

    echo "Check if response starts with: $2"
    if [[ $response == $startsWith ]]; then
        echo "API is up!"
        break
    fi
    sleep $delay
done