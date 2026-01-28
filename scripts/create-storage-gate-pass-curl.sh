#!/usr/bin/env bash
# Create a storage gate pass from two grading gate passes.
# Base URL: change to your server (e.g. http://localhost:3000)
BASE_URL="${BASE_URL:-http://localhost:3000}"

curl -X POST "${BASE_URL}/api/v1/storage-gate-pass" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
  "gatePassNo": 1,
  "date": "2026-01-28",
  "variety": "Himalini",
  "gradingGatePasses": [
    {
      "gradingGatePassId": "697a1921a77c08ec7e1dac63",
      "allocations": [
        {
          "size": "30-40",
          "quantityToAllocate": 10,
          "chamber": "C1",
          "floor": "F1",
          "row": "R1"
        },
        {
          "size": "below-40",
          "quantityToAllocate": 20,
          "chamber": "C1",
          "floor": "F1",
          "row": "R1"
        }
      ]
    },
    {
      "gradingGatePassId": "697a1936a77c08ec7e1dac68",
      "allocations": [
        {
          "size": "30-40",
          "quantityToAllocate": 5,
          "chamber": "C1",
          "floor": "F1",
          "row": "R1"
        },
        {
          "size": "below-40",
          "quantityToAllocate": 10,
          "chamber": "C1",
          "floor": "F1",
          "row": "R1"
        }
      ]
    }
  ],
  "remarks": "Storage from grading gate passes 1 and 2"
}'
