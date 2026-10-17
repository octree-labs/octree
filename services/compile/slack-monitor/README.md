# Slack Health Monitor

Monitors LaTeX compilation servers and sends hourly health reports to Slack.

## Features

- ✅ Hourly health checks for Production and Staging servers
- 📊 Reports CPU, memory, queue status, and active compilations
- ⚠️ Alerts on issues (high CPU, memory, stuck processes)
- 🔴 Immediate alerts when servers are down

## Setup

### 1. Create a Slack App

1. Go to [api.slack.com/apps](https://api.slack.com/apps)
2. Click **Create New App** → **From scratch**
3. Name it "Server Health Monitor" and select your workspace
4. Go to **OAuth & Permissions** and add these Bot Token Scopes:
   - `chat:write` - Send messages
   - `chat:write.public` - Send to public channels without joining
5. Click **Install to Workspace**
6. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 2. Configure Environment

```bash
cp env.sample .env
# Edit .env with your token and channel
```

### 3. Run Locally

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run
export SLACK_BOT_TOKEN="xoxb-your-token"
export SLACK_CHANNEL="#server-health"
python health_monitor.py
```

### 4. Run with Docker

```bash
docker build -t health-monitor .
docker run -d \
  -e SLACK_BOT_TOKEN="xoxb-your-token" \
  -e SLACK_CHANNEL="#server-health" \
  -e CHECK_INTERVAL=3600 \
  --name health-monitor \
  health-monitor
```

### 5. Deploy to Server

```bash
# On the server
cd /root
git clone <repo> health-monitor
cd health-monitor/slack-monitor

# Create .env file
cat > .env << EOF
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_CHANNEL=#server-health
CHECK_INTERVAL=3600
EOF

# Run with Docker
docker build -t health-monitor .
docker run -d --restart=always \
  --env-file .env \
  --name health-monitor \
  health-monitor
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SLACK_BOT_TOKEN` | Slack bot token (required) | - |
| `SLACK_CHANNEL` | Channel for reports | `#server-health` |
| `CHECK_INTERVAL` | Seconds between checks | `3600` (1 hour) |
| `HEALTH_URL` | Health endpoint to monitor (required) | - |

## Sample Output

```
✅ Server Health Report
🕐 2026-01-05 20:30:00 UTC
────────────────────────
🟢 Production
🟢 Status: ok | ⏱️ Response: 245ms
• CPU: 5.2%
• Memory: 22.5% (880 MB)
• Queue: 0/4
• Active compilations: 0
────────────────────────
🟡 Staging
🟢 Status: ok | ⏱️ Response: 312ms
• CPU: 1.5%
• Memory: 26.1% (513 MB)
• Queue: 0/4
• Active compilations: 0
```

