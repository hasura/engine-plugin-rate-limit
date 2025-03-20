#!/bin/bash

# A bash script to test the rate-limit in dev

# Number of requests to send (default: 15)
NUM_REQUESTS=${1:-15}
# Delay between requests in seconds (default: 0.5)
DELAY=${2:-0.5}

echo "Sending $NUM_REQUESTS requests with ${DELAY}s delay between each..."
echo

for i in $(seq 1 $NUM_REQUESTS); do
    echo "Request $i:"
    # Store the response headers and body in variables
    response=$(curl -X POST http://localhost:3000/rate-limit \
        -H "Content-Type: application/json" \
        -H "hasura-m-auth: your-auth-token" \
        -H "x-user-id: user123" \
        -H "x-client-id: client456" \
        -H "x-hasura-role: user" \
        -d '{
            "rawRequest": {
                "query": "query { users { id name } }",
                "variables": {},
                "operationName": "GetUsers"
            },
            "session": {
                "role": "user",
                "variables": {
                    "user.id": "user123"
                }
            }
        }' \
        -w "\nStatus Code: %{http_code}\n" \
        -s)
    
    # Print the response
    echo "$response" | head -n -1 | jq '.' 2>/dev/null || echo "Failed to parse JSON response"
    echo -e "$(echo "$response" | tail -n 1)"
    
    echo -e "\nTimestamp: $(date '+%H:%M:%S')"
    echo "----------------------------------------"
    
    sleep $DELAY
done
