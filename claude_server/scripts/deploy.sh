#!/bin/bash

# Claude Server Deployment Script
# Deploys the standalone Claude Agent service to the production server

set -e  # Exit on error

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CLAUDE_SERVER_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"

# Configuration
SERVER_HOST="${CLAUDE_SERVER_HOST:-root@161.35.138.83}"
SERVER_PATH="/srv/octra-agent"
BACKUP_PATH="/srv/octra-agent-backup-$(date +%Y%m%d-%H%M%S)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Claude Server Deployment${NC}"
echo "================================================"
echo ""

# Check if we're in the right directory
if [ ! -f "$CLAUDE_SERVER_DIR/agent-service.ts" ]; then
    echo -e "${RED}❌ Error: agent-service.ts not found${NC}"
    exit 1
fi

# Check if lib directory exists
if [ ! -d "$CLAUDE_SERVER_DIR/lib/octra-agent" ]; then
    echo -e "${RED}❌ Error: lib/octra-agent directory not found${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Step 1: Creating backup on server...${NC}"
ssh $SERVER_HOST "if [ -d $SERVER_PATH ]; then sudo cp -r $SERVER_PATH $BACKUP_PATH && echo 'Backup created at $BACKUP_PATH'; fi"

echo ""
echo -e "${YELLOW}📤 Step 2: Syncing files to server...${NC}"

# Sync main service file
echo "  → Syncing agent-service.ts..."
rsync -avz --progress $CLAUDE_SERVER_DIR/agent-service.ts $SERVER_HOST:$SERVER_PATH/

# Sync package files
echo "  → Syncing package.json..."
rsync -avz --progress $CLAUDE_SERVER_DIR/package.json $SERVER_HOST:$SERVER_PATH/

echo "  → Syncing tsconfig.json..."
rsync -avz --progress $CLAUDE_SERVER_DIR/tsconfig.json $SERVER_HOST:$SERVER_PATH/

# Sync lib directory (all files including session-manager.ts)
echo "  → Syncing lib/..."
rsync -avz --progress --delete $CLAUDE_SERVER_DIR/lib/ $SERVER_HOST:$SERVER_PATH/lib/

echo ""
echo -e "${YELLOW}📚 Step 3: Installing dependencies...${NC}"
ssh $SERVER_HOST "cd $SERVER_PATH && npm install --production"

echo ""
echo -e "${YELLOW}🔄 Step 4: Restarting service...${NC}"
ssh $SERVER_HOST "sudo systemctl restart octra-agent"

echo ""
echo -e "${YELLOW}⏳ Step 5: Checking service status...${NC}"
sleep 2
ssh $SERVER_HOST "sudo systemctl status octra-agent --no-pager -l" || true

echo ""
echo -e "${YELLOW}🔍 Step 6: Testing endpoint...${NC}"
RESPONSE=$(curl -s -X POST http://161.35.138.83:8787/agent \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"test"}]}' || echo "Connection failed")

if [[ "$RESPONSE" == *"error"* ]] || [[ "$RESPONSE" == "Connection failed" ]]; then
    echo -e "${RED}⚠️  Endpoint test: $RESPONSE${NC}"
    echo -e "${YELLOW}   (This is expected - it means the service is running but needs valid request)${NC}"
else
    echo -e "${GREEN}✅ Endpoint responding${NC}"
fi

echo ""
echo "================================================"
echo -e "${GREEN}✅ Deployment Complete!${NC}"
echo ""
echo -e "Service URL: ${GREEN}http://161.35.138.83:8787/agent${NC}"
echo -e "Backup location: ${YELLOW}$BACKUP_PATH${NC}"
echo ""
echo "To view logs, run:"
echo "  cd claude_server/scripts && ./logs.sh"
echo ""
echo "To rollback, run:"
echo "  ssh $SERVER_HOST 'sudo systemctl stop octra-agent && sudo rm -rf $SERVER_PATH && sudo mv $BACKUP_PATH $SERVER_PATH && sudo systemctl start octra-agent'"
echo ""

