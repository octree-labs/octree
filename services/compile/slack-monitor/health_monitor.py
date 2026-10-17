#!/usr/bin/env python3
"""
Slack Health Monitor for LaTeX Compilation Servers
Sends hourly health pings and alerts on issues.
"""

import os
import time
import json
import logging
import requests
from datetime import datetime
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

# Configuration
SLACK_BOT_TOKEN = os.environ.get("SLACK_BOT_TOKEN")
SLACK_CHANNEL = os.environ.get("SLACK_CHANNEL", "#server-health")
CHECK_INTERVAL = int(os.environ.get("CHECK_INTERVAL", 3600))  # Default: 1 hour
HEALTH_URL = os.environ.get("HEALTH_URL")

SERVERS = [
    {
        "name": "Production",
        "url": HEALTH_URL,
        "emoji": "🟢"
    },
]

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)


def check_server_health(server: dict) -> dict:
    """Check health of a single server."""
    result = {
        "name": server["name"],
        "emoji": server["emoji"],
        "url": server["url"],
        "status": "unknown",
        "response_time_ms": None,
        "data": None,
        "error": None
    }
    
    try:
        start = time.time()
        response = requests.get(server["url"], timeout=10)
        result["response_time_ms"] = int((time.time() - start) * 1000)
        
        if response.status_code == 200:
            data = response.json()
            result["status"] = data.get("status", "ok")
            result["data"] = data
        elif response.status_code == 503:
            data = response.json()
            result["status"] = data.get("status", "unhealthy")
            result["data"] = data
        else:
            result["status"] = "error"
            result["error"] = f"HTTP {response.status_code}"
            
    except requests.exceptions.Timeout:
        result["status"] = "timeout"
        result["error"] = "Request timed out after 10s"
    except requests.exceptions.ConnectionError:
        result["status"] = "down"
        result["error"] = "Connection refused"
    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)
    
    return result


def format_health_message(results: list) -> dict:
    """Format health check results as a Slack message."""
    timestamp = datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S UTC")
    
    # Determine overall status
    all_ok = all(r["status"] == "ok" for r in results)
    any_down = any(r["status"] in ["down", "timeout", "error"] for r in results)
    
    if any_down:
        header_emoji = "🚨"
        header_text = "Server Health Alert"
    elif not all_ok:
        header_emoji = "⚠️"
        header_text = "Server Health Warning"
    else:
        header_emoji = "✅"
        header_text = "Server Health Report"
    
    blocks = [
        {
            "type": "header",
            "text": {
                "type": "plain_text",
                "text": f"{header_emoji} {header_text}",
                "emoji": True
            }
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": f"🕐 {timestamp}"
                }
            ]
        },
        {"type": "divider"}
    ]
    
    for result in results:
        status_emoji = get_status_emoji(result["status"])
        
        # Server header
        fields = [
            {
                "type": "mrkdwn",
                "text": f"*{result['emoji']} {result['name']}*\n{status_emoji} Status: `{result['status']}`"
            }
        ]
        
        if result["response_time_ms"] is not None:
            fields.append({
                "type": "mrkdwn",
                "text": f"⏱️ Response: `{result['response_time_ms']}ms`"
            })
        
        blocks.append({
            "type": "section",
            "fields": fields
        })
        
        # System stats if available
        if result["data"] and result["data"].get("system"):
            sys = result["data"]["system"]
            stats_text = (
                f"• CPU: `{sys.get('cpuPercent', 0):.1f}%`\n"
                f"• Memory: `{sys.get('memoryPercent', 0):.1f}%` ({sys.get('memoryUsedMB', 0)} MB)\n"
                f"• Queue: `{result['data'].get('queueLength', 0)}/{result['data'].get('queueCapacity', 0)}`\n"
                f"• Active compilations: `{sys.get('activeCompilations', 0)}`"
            )
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": stats_text
                }
            })
            
            # Issues
            issues = result["data"].get("issues", [])
            if issues:
                issues_text = "⚠️ *Issues:*\n" + "\n".join(f"• {issue}" for issue in issues)
                blocks.append({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": issues_text
                    }
                })
            
            # Stuck processes
            stuck = sys.get("stuckProcesses", [])
            if stuck:
                stuck_text = "🔴 *Stuck Processes:*\n" + "\n".join(
                    f"• PID {p['pid']}: `{p['command']}` ({p['runningFor']})"
                    for p in stuck
                )
                blocks.append({
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": stuck_text
                    }
                })
        
        # Error message
        if result["error"]:
            blocks.append({
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": f"❌ *Error:* {result['error']}"
                }
            })
        
        blocks.append({"type": "divider"})
    
    return {"blocks": blocks}


def get_status_emoji(status: str) -> str:
    """Get emoji for status."""
    return {
        "ok": "🟢",
        "degraded": "🟡",
        "unhealthy": "🔴",
        "down": "⬛",
        "timeout": "⏰",
        "error": "❌",
        "unknown": "❓"
    }.get(status, "❓")


def send_slack_message(client: WebClient, channel: str, message: dict) -> bool:
    """Send message to Slack."""
    try:
        client.chat_postMessage(
            channel=channel,
            blocks=message["blocks"],
            text="Server Health Report"  # Fallback for notifications
        )
        logger.info(f"Message sent to {channel}")
        return True
    except SlackApiError as e:
        logger.error(f"Slack API error: {e.response['error']}")
        return False


def run_health_check(client: WebClient, channel: str):
    """Run a single health check cycle."""
    logger.info("Running health check...")
    
    results = []
    for server in SERVERS:
        logger.info(f"Checking {server['name']}...")
        result = check_server_health(server)
        results.append(result)
        logger.info(f"  {server['name']}: {result['status']}")
    
    message = format_health_message(results)
    send_slack_message(client, channel, message)


def main():
    """Main entry point."""
    if not SLACK_BOT_TOKEN:
        logger.error("SLACK_BOT_TOKEN environment variable is required")
        return 1
    if not HEALTH_URL:
        logger.error("HEALTH_URL environment variable is required")
        return 1
    
    client = WebClient(token=SLACK_BOT_TOKEN)
    
    # Test connection
    try:
        auth = client.auth_test()
        logger.info(f"Connected as {auth['user']} to {auth['team']}")
    except SlackApiError as e:
        logger.error(f"Failed to connect to Slack: {e.response['error']}")
        return 1
    
    logger.info(f"Starting health monitor (interval: {CHECK_INTERVAL}s)")
    logger.info(f"Sending reports to: {SLACK_CHANNEL}")
    
    # Initial check
    run_health_check(client, SLACK_CHANNEL)
    
    # Continuous monitoring
    while True:
        time.sleep(CHECK_INTERVAL)
        run_health_check(client, SLACK_CHANNEL)


if __name__ == "__main__":
    exit(main() or 0)

