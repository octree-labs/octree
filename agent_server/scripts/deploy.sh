#!/bin/bash

# Agent Server Deployment Script
# Syncs files to the server, builds the Docker image remotely, and runs via docker compose.

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
AGENT_SERVER_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

IMAGE_NAME="octra-agent"
IMAGE_TAG="latest"
SERVER_PATH="/srv/octra-agent"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Load DEPLOY_HOST from .env ──────────────────────────────────────────────

if [ -f "$AGENT_SERVER_DIR/.env" ]; then
    DEPLOY_HOST=$(grep '^DEPLOY_HOST=' "$AGENT_SERVER_DIR/.env" | cut -d '=' -f2)
fi

if [ -z "$DEPLOY_HOST" ]; then
    echo -e "${RED}Error: DEPLOY_HOST not set. Add it to agent_server/.env${NC}"
    exit 1
fi

SERVER_HOST="${AGENT_SERVER_HOST:-root@$DEPLOY_HOST}"

echo -e "${GREEN}Agent Server Deployment (Docker)${NC}"
echo "================================================"
echo -e "Host: ${YELLOW}${SERVER_HOST}${NC}"
echo ""

# ── Validate local files ────────────────────────────────────────────────────

for f in Dockerfile docker-compose.yml agent-service.ts; do
    if [ ! -f "$AGENT_SERVER_DIR/$f" ]; then
        echo -e "${RED}Error: $f not found in $AGENT_SERVER_DIR${NC}"
        exit 1
    fi
done

if [ ! -d "$AGENT_SERVER_DIR/lib" ]; then
    echo -e "${RED}Error: lib/ directory not found${NC}"
    exit 1
fi

# ── Step 1: Sync files to server ────────────────────────────────────────────

echo -e "${YELLOW}Step 1/4: Syncing files to server...${NC}"
ssh "$SERVER_HOST" "mkdir -p $SERVER_PATH/lib"

scp "$AGENT_SERVER_DIR/Dockerfile" "$SERVER_HOST:$SERVER_PATH/"
scp "$AGENT_SERVER_DIR/docker-compose.yml" "$SERVER_HOST:$SERVER_PATH/"
scp "$AGENT_SERVER_DIR/package.json" "$SERVER_HOST:$SERVER_PATH/"
scp "$AGENT_SERVER_DIR/package-lock.json" "$SERVER_HOST:$SERVER_PATH/"
scp "$AGENT_SERVER_DIR/tsconfig.json" "$SERVER_HOST:$SERVER_PATH/"
scp "$AGENT_SERVER_DIR/agent-service.ts" "$SERVER_HOST:$SERVER_PATH/"
rsync -avz --delete "$AGENT_SERVER_DIR/lib/" "$SERVER_HOST:$SERVER_PATH/lib/"

# Sync .env only if the server doesn't already have one
ssh "$SERVER_HOST" "test -f ${SERVER_PATH}/.env" 2>/dev/null || {
    echo -e "  ${YELLOW}No .env on server — syncing local .env (minus DEPLOY_HOST)...${NC}"
    grep -v '^DEPLOY_HOST=' "$AGENT_SERVER_DIR/.env" | ssh "$SERVER_HOST" "cat > ${SERVER_PATH}/.env"
}
echo ""

# ── Step 2: Build image on server ───────────────────────────────────────────

echo -e "${YELLOW}Step 2/4: Building Docker image on server...${NC}"
ssh "$SERVER_HOST" "cd $SERVER_PATH && docker build -t ${IMAGE_NAME}:${IMAGE_TAG} ."
echo ""

# ── Step 3: Start container ─────────────────────────────────────────────────

echo -e "${YELLOW}Step 3/4: Restarting container...${NC}"
ssh "$SERVER_HOST" "cd $SERVER_PATH && docker compose down --remove-orphans 2>/dev/null || true && docker compose up -d"
echo ""

# ── Step 4: Health check ────────────────────────────────────────────────────

echo -e "${YELLOW}Step 4/4: Health check...${NC}"
sleep 3

RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "http://$DEPLOY_HOST:8787/agent" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}],"fileContent":"test"}' \
  --max-time 5 || echo "000")

if [ "$RESPONSE" = "000" ]; then
    echo -e "${RED}  Endpoint test: Connection failed${NC}"
elif [ "$RESPONSE" = "401" ] || [ "$RESPONSE" = "400" ] || [ "$RESPONSE" = "503" ]; then
    echo -e "${GREEN}  Service responding (HTTP $RESPONSE — server is alive)${NC}"
else
    echo -e "${GREEN}  Endpoint responding (HTTP $RESPONSE)${NC}"
fi

echo ""
echo -e "${YELLOW}Container status:${NC}"
ssh "$SERVER_HOST" "docker ps --filter name=octra-agent --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'"

echo ""
echo "================================================"
echo -e "${GREEN}Deployment Complete!${NC}"
echo ""
echo -e "Service URL: ${GREEN}http://$DEPLOY_HOST:8787/agent${NC}"
echo ""
echo "Useful commands:"
echo "  View logs:     ssh $SERVER_HOST 'docker logs -f octra-agent'"
echo "  Restart:       ssh $SERVER_HOST 'cd $SERVER_PATH && docker compose restart'"
echo "  Stop:          ssh $SERVER_HOST 'cd $SERVER_PATH && docker compose down'"
echo "  Shell into:    ssh $SERVER_HOST 'docker exec -it octra-agent sh'"
echo ""
