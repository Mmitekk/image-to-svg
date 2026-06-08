#!/bin/bash
cd /home/z/my-project
while true; do
  NODE_ENV=production node .next/standalone/server.js
  echo "Server crashed at $(date), restarting in 3s..."
  sleep 3
done
