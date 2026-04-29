#!/bin/bash
sleep 3
if command -v pm2 &> /dev/null; then
  pm2 restart all
else
  ROOT="$(cd "$(dirname "$0")" && pwd)"
  nohup node "$ROOT/backend/server.js" >> "$ROOT/backend.log" 2>&1 &
fi
