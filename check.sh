while true; do
    curl -s -o response.txt -w "%{http_code}" http://localhost:8000/openapi.json -H "Accept: application/json" -H "Content-Type: application/json" > /dev/null
    response=$(head -c 10 response.txt)
    echo "response: $response"
    if [[ $response == "{\"openapi\"" ]]; then
        echo "Backend service is up!"
        break
    fi
    sleep 5
done