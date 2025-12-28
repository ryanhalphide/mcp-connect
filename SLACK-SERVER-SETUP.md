# Slack MCP Server Setup

## Overview

The Slack MCP server (`slack-mcp-server`) provides integration with Slack for reading messages, sending messages, searching conversations, and managing channels. It supports both OAuth authentication and stealth mode.

## Configuration

### 1. Choose Authentication Method

You have two options for authenticating with Slack:

#### Option A: OAuth Token (Recommended for Production)

1. Go to https://api.slack.com/apps
2. Click "Create New App" → "From scratch"
3. Give it a name (e.g., "MCP Connect") and select your workspace
4. Navigate to "OAuth & Permissions"
5. Add the following scopes under "Bot Token Scopes":
   - ✅ `channels:history` - View messages in public channels
   - ✅ `channels:read` - View basic channel information
   - ✅ `chat:write` - Send messages (optional, for posting)
   - ✅ `groups:history` - View messages in private channels
   - ✅ `groups:read` - View basic private channel information
   - ✅ `im:history` - View messages in direct messages
   - ✅ `im:read` - View basic direct message information
   - ✅ `mpim:history` - View messages in group direct messages
   - ✅ `mpim:read` - View basic group direct message information
6. Click "Install to Workspace"
7. **Copy the Bot User OAuth Token** (starts with `xoxb-`)

#### Option B: Stealth Mode (Development/Personal Use)

1. Open Slack in your web browser
2. Open browser developer tools (F12)
3. Go to the "Application" or "Storage" tab
4. Find cookies for your Slack workspace
5. Look for the cookie named `d` (contains `xoxc-` token)
6. Copy the token value

### 2. Configure Environment Variable

#### Local Development

Add to `.env`:
```bash
SLACK_TOKEN=xoxb-your-token-here  # For OAuth
# OR
SLACK_TOKEN=xoxc-your-token-here  # For Stealth Mode
```

#### Railway Deployment

1. Go to Railway project settings
2. Navigate to "Variables" tab
3. Add environment variable:
   - **Key:** `SLACK_TOKEN`
   - **Value:** Your Slack token (xoxb-* or xoxc-*)

### 3. Server Configuration

The Slack server is already configured in `config/servers.json`:

```json
{
  "name": "slack",
  "description": "Slack integration for reading messages, sending messages, and managing channels",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "slack-mcp-server"],
    "env": {}
  },
  "rateLimits": {
    "requestsPerMinute": 20,
    "requestsPerDay": 2000
  }
}
```

The server automatically inherits the `SLACK_TOKEN` from the parent process environment.

## Available Tools

The Slack MCP server provides these tools:

### 1. **`slack/conversations_history`**
Get messages from a channel or direct message

**Parameters:**
- `channel` (required): Channel ID (e.g., "C1234567890")
- `limit`: Maximum number of messages to retrieve (default: 100)
- `oldest`: Only messages after this timestamp
- `latest`: Only messages before this timestamp

### 2. **`slack/conversations_replies`**
Get all messages in a thread

**Parameters:**
- `channel` (required): Channel ID
- `ts` (required): Thread timestamp (message ID)
- `limit`: Maximum number of replies (default: 100)

### 3. **`slack/conversations_add_message`**
Send a message to a channel or DM

**Parameters:**
- `channel` (required): Channel ID
- `text` (required): Message text
- `thread_ts`: Send as reply to this thread

⚠️ **Note:** This tool is disabled by default for safety. The MCP server configuration needs to be modified to enable it.

### 4. **`slack/conversations_search_messages`**
Search for messages across conversations

**Parameters:**
- `query` (required): Search query
- `channel`: Limit search to specific channel
- `from`: Filter by user
- `after`: Only messages after this date
- `before`: Only messages before this date
- `limit`: Maximum results (default: 20)

### 5. **`slack/channels_list`**
List all channels in the workspace

**Parameters:**
- `types`: Channel types (public, private, im, mpim)
- `exclude_archived`: Exclude archived channels (default: true)
- `limit`: Maximum channels to return

## Usage Examples

### Get Channel History

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/slack/conversations_history/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "channel": "C1234567890",
      "limit": 50
    }
  }'
```

### Get Thread Replies

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/slack/conversations_replies/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "channel": "C1234567890",
      "ts": "1234567890.123456"
    }
  }'
```

### Search Messages

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/slack/conversations_search_messages/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "query": "important announcement",
      "limit": 20
    }
  }'
```

### List Channels

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/slack/channels_list/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "types": "public_channel,private_channel",
      "exclude_archived": true
    }
  }'
```

### Send a Message (if enabled)

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/slack/conversations_add_message/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "channel": "C1234567890",
      "text": "Hello from MCP Connect!"
    }
  }'
```

## Finding Channel IDs

There are several ways to find Slack channel IDs:

### Method 1: Via Slack App
1. Right-click on any channel in Slack
2. Select "View channel details"
3. Scroll to the bottom - the channel ID is shown

### Method 2: Via URL
1. Open the channel in Slack web app
2. Look at the URL: `https://app.slack.com/client/T.../C...`
3. The part starting with `C` is the channel ID

### Method 3: Use the channels_list Tool
```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/slack/channels_list/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"params": {}}'
```

## Troubleshooting

### "Invalid authentication" Error

**Cause:** Missing or invalid Slack token

**Solution:**
1. Verify `SLACK_TOKEN` is set in environment
2. Check token hasn't expired (stealth tokens expire)
3. For OAuth: Ensure bot has required scopes
4. For Stealth: Token expires when you log out - regenerate
5. Restart MCP Connect server after adding token

### "Missing required scope" Error

**Cause:** OAuth token lacks required permissions

**Solution:**
1. Go to https://api.slack.com/apps
2. Select your app
3. Navigate to "OAuth & Permissions"
4. Add missing scopes under "Bot Token Scopes"
5. Reinstall app to workspace
6. Update `SLACK_TOKEN` with new token
7. Restart server

### "Channel not found" Error

**Cause:** Invalid channel ID or bot not invited to channel

**Solution:**
1. Verify channel ID is correct
2. For private channels: Invite the bot to the channel first
3. Use `/invite @YourBotName` in the channel
4. Retry the operation

### Messages Not Appearing

**Cause:** Bot doesn't have access to historical messages or channels

**Solution:**
1. For public channels: Bot should have automatic access
2. For private channels: Invite bot explicitly
3. Check `channels:history` and `groups:history` scopes are granted
4. Verify bot is member of the channel

### Slack Server Not Connecting

**Symptoms:** Health endpoint shows slack server as disconnected

**Solutions:**
1. Verify `SLACK_TOKEN` is set in environment
2. Check Railway environment variables (for production)
3. Test token validity with Slack API test endpoint
4. Check Railway deployment logs for connection errors
5. Ensure `slack-mcp-server` package can be installed via npx

## Security Notes

1. **Token Security**
   - Never commit tokens to git
   - Add `.env` to `.gitignore`
   - Use environment variables only
   - Rotate tokens regularly

2. **OAuth vs Stealth Mode**
   - OAuth: More secure, doesn't expire, recommended for production
   - Stealth: Expires on logout, good for development/testing
   - Never share stealth tokens (they grant full account access)

3. **Scope Principle**
   - Only grant necessary permissions
   - Read-only scopes for monitoring
   - Add `chat:write` only if sending messages is needed

4. **Production Security**
   - Store token in Railway environment variables
   - Use separate tokens for dev/prod
   - Monitor bot activity in Slack admin
   - Disable messaging tools if not needed

5. **Revoke Compromised Tokens**
   - If token is exposed, revoke immediately
   - For OAuth: Regenerate in Slack App settings
   - For Stealth: Log out and generate new token
   - Update environment variables

## Features

- **Smart History Fetch**: Automatically retrieves message history efficiently
- **Thread Support**: Full support for threaded conversations
- **DM/Group DM**: Works with direct messages and group DMs
- **Search**: Powerful message search across workspace
- **Proxy Support**: Can work through HTTP proxies (via MCP server config)
- **Cache Support**: Caches channel lists and metadata for performance

## Package Information

- **Package:** `slack-mcp-server`
- **Version:** 1.1.28
- **License:** MIT
- **Repository:** https://www.npmjs.com/package/slack-mcp-server

## Additional Resources

- [Slack API Documentation](https://api.slack.com/docs)
- [Slack OAuth Guide](https://api.slack.com/authentication/oauth-v2)
- [Slack Bot Token Scopes](https://api.slack.com/scopes)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
