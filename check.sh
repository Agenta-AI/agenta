while true; do
    curl -s -o response.txt -w "%{http_code}" http://localhost/api/openapi.json -H "Accept: application/json" -H "Content-Type: application/json" > /dev/null
    response=$(head -c 10 response.txt)
    echo "response: $response"
    if [[ $response == "{\"openapi\"" ]]; then
        echo "here"
        break
    fi
    sleep 5
done