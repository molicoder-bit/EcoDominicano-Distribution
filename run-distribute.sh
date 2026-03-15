#!/bin/bash
# Wrapper for npm run distribute — finds Node/npm from nvm, /opt/node, or PATH
set -e
cd /opt/ecodominicano-distributor
export PATH="/opt/node/bin:/usr/local/bin:$PATH"
export NVM_DIR="${HOME:-/home/ecodist}/.nvm"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi
exec npm run distribute -- --mode=scheduled
