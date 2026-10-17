#!/bin/bash
set -e  # Exit on any error
cd "$(dirname "$0")/.."  # rsync below syncs ./ — must be services/compile/, not the repo root
# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration (overridable via env vars for CI/CD)
if [ -z "$SERVER_IP" ] && [ -f .env ]; then
  SERVER_IP=$(grep '^DEPLOY_HOST=' .env | cut -d '=' -f2)
fi
if [ -z "$SERVER_IP" ]; then
  echo -e "${RED}Error: SERVER_IP not set. Export it or add DEPLOY_HOST to services/compile/.env${NC}"
  exit 1
fi
SERVER_USER="${SERVER_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/root/octree-compile}"
SERVICE_NAME="${SERVICE_NAME:-octree-compile}"
DOCKER_IMAGE="${DOCKER_IMAGE:-octree-compile:latest}"
FONT_BASE_IMAGE="${FONT_BASE_IMAGE:-octree/latex-fonts:2025}"
TEXLIVE_BASE_IMAGE="${TEXLIVE_BASE_IMAGE:-octree/texlive-runtime:2025}"
PUBLIC_PORT="${PUBLIC_PORT:-80}"

echo -e "${GREEN}🚀 Starting deployment to $SERVER_IP${NC}"

# Step 1: Setup Docker on server if needed
echo -e "${YELLOW}🔧 Setting up Docker on server...${NC}"
ssh $SERVER_USER@$SERVER_IP << 'ENDSETUP'
set -e
# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "📦 Docker not found. Installing Docker..."
    apt-get update
    apt-get install -y ca-certificates curl gnupg lsb-release
    
    # Add Docker's official GPG key
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
    
    # Set up the repository
    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker Engine
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    
    # Start and enable Docker
    systemctl start docker
    systemctl enable docker
    
    echo "✅ Docker installed successfully"
else
    echo "✅ Docker is already installed"
    docker --version
fi
# Check if docker-compose is available (either standalone or plugin)
if command -v docker-compose &> /dev/null; then
    echo "✅ docker-compose is already installed"
    docker-compose --version
elif docker compose version &> /dev/null; then
    echo "✅ docker compose (plugin) is available"
    docker compose version
    # Create an alias/wrapper for docker-compose
    if [ ! -f /usr/local/bin/docker-compose ]; then
        echo '#!/bin/bash' > /usr/local/bin/docker-compose
        echo 'docker compose "$@"' >> /usr/local/bin/docker-compose
        chmod +x /usr/local/bin/docker-compose
        echo "✅ Created docker-compose wrapper"
    fi
else
    echo "📦 Installing docker-compose..."
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo "✅ docker-compose installed successfully"
    docker-compose --version
fi
ENDSETUP

# Step 2: Sync code to server
echo -e "${YELLOW}📦 Syncing code to server...${NC}"
rsync -avz --delete \
  --exclude 'logs/' \
  --exclude 'latex-compile' \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  ./ $SERVER_USER@$SERVER_IP:$REMOTE_DIR/

# Step 3: Deploy on server
echo -e "${YELLOW}🔧 Deploying on server...${NC}"
ssh $SERVER_USER@$SERVER_IP "FONT_BASE_IMAGE='$FONT_BASE_IMAGE' TEXLIVE_BASE_IMAGE='$TEXLIVE_BASE_IMAGE' bash -s" <<'ENDSSH'
set -e
cd /root/octree-compile
echo "🎨 Ensuring font base image: $FONT_BASE_IMAGE"
if ! docker image inspect "$FONT_BASE_IMAGE" >/dev/null 2>&1; then
  echo "🧱 Building font base image $FONT_BASE_IMAGE..."
  docker build -f deployments/Dockerfile.fonts-base -t "$FONT_BASE_IMAGE" .
fi
echo "📚 Ensuring TeX Live base image: $TEXLIVE_BASE_IMAGE"
if ! docker image inspect "$TEXLIVE_BASE_IMAGE" >/dev/null 2>&1; then
  echo "🧱 Building TeX Live base image $TEXLIVE_BASE_IMAGE..."
  docker build -f deployments/Dockerfile.texlive-base --build-arg FONT_BASE_IMAGE="$FONT_BASE_IMAGE" -t "$TEXLIVE_BASE_IMAGE" .
fi
echo "🧹 Checking disk space..."
DISK_USAGE=$(df --output=pcent / | tail -1 | tr -dc '0-9')
echo "Current root filesystem usage: ${DISK_USAGE}%"
if [ "$DISK_USAGE" -gt 85 ]; then
  echo "⚠️  Low disk space detected. Running docker prune..."
  docker system prune -af || true
  docker builder prune -af || true
  docker volume prune -f || true
  echo "Disk usage after prune:"
  df -h /
fi
echo "🛑 Stopping existing containers..."
docker-compose -f deployments/docker-compose.prod.yml down || true
echo "🏗️  Building Docker image..."
export TEXLIVE_BASE_IMAGE
docker-compose -f deployments/docker-compose.prod.yml build --no-cache
echo "🚀 Starting services..."
docker-compose -f deployments/docker-compose.prod.yml up -d
echo "⏳ Waiting for service to be ready..."
for i in {1..12}; do
  if curl -fs "http://localhost:${PUBLIC_PORT}/health" >/dev/null 2>&1; then
    echo "✅ Health check passed"
    break
  fi
  echo "⏳ Health check pending... (${i}/12)"
  sleep 3
done
echo "✅ Checking service status..."
docker-compose -f deployments/docker-compose.prod.yml ps
echo "📊 Container logs:"
docker-compose -f deployments/docker-compose.prod.yml logs --tail=20
echo "🧪 Testing health endpoint..."
curl -fs "http://localhost:${PUBLIC_PORT}/health" || echo "Health check failed"
ENDSSH

# Step 4: Test the deployment
echo -e "${YELLOW}🧪 Testing deployment...${NC}"
sleep 2
if ssh $SERVER_USER@$SERVER_IP "curl -fs http://localhost:${PUBLIC_PORT}/health" | grep -q "ok"; then
    echo -e "${GREEN}✅ Deployment successful!${NC}"
    echo -e "${GREEN}Service is running at: https://$SERVER_IP:${PUBLIC_PORT}${NC}"
else
    echo -e "${RED}❌ Deployment may have issues. Check logs.${NC}"
    exit 1
fi

# Step 5: Show useful commands
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}════════════════════════════════════════${NC}"
echo ""
echo "📝 Useful commands:"
echo "  View logs:    ssh $SERVER_USER@$SERVER_IP 'cd $REMOTE_DIR && docker-compose -f deployments/docker-compose.prod.yml logs -f'"
echo "  Restart:      ssh $SERVER_USER@$SERVER_IP 'cd $REMOTE_DIR && docker-compose -f deployments/docker-compose.prod.yml restart'"
echo "  Stop:         ssh $SERVER_USER@$SERVER_IP 'cd $REMOTE_DIR && docker-compose -f deployments/docker-compose.prod.yml down'"
echo "  Shell access: ssh $SERVER_USER@$SERVER_IP 'cd $REMOTE_DIR && docker-compose -f deployments/docker-compose.prod.yml exec latex-compile /bin/sh'"
echo ""
echo "🌐 API Endpoints:"
echo "  Health: https://$SERVER_IP:${PUBLIC_PORT}/health"
echo "  Compile: https://$SERVER_IP:${PUBLIC_PORT}/compile"
echo ""