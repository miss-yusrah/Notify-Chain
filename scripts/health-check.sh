#!/bin/bash
TARGET_URL=${1:-"http://localhost:3000/health"}
STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$TARGET_URL")
if [ "$STATUS" -eq 200 ]; then
  exit 0
else
  exit 1
fi
