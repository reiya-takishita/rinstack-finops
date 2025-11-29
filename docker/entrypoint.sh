#!/bin/sh

# prepare sacloud mcp
mkdir -p /rinstack_finops/tmp
mkdir -p /rinstack_finops/tmp/sacloud-mcp

# Clone or update sacloud-mcp repository
if [ ! -d "/rinstack_finops/tmp/sacloud-mcp/.git" ]; then
    git clone https://github.com/sacloud/sacloud-mcp.git /rinstack_finops/tmp/sacloud-mcp
else
    cd /rinstack_finops/tmp/sacloud-mcp && git pull
fi

exec "$@"
