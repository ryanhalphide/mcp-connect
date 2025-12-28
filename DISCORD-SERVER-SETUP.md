# Discord MCP Server Setup

## Overview

The Discord MCP server (`mcp-server-discord`) provides comprehensive Discord integration for server management, message operations, channel management, webhooks, and more. It requires a Discord bot token for authentication.

## Configuration

### 1. Create a Discord Bot

1. Go to https://discord.com/developers/applications
2. Click "New Application"
3. Give it a name (e.g., "MCP Connect Bot")
4. Navigate to the "Bot" tab in the left sidebar
5. Click "Add Bot" and confirm
6. **Copy the Bot Token** (click "Reset Token" if needed)
7. ⚠️ **Important:** Keep this token secret - it grants full access to your bot

### 2. Configure Bot Permissions

Still in the Discord Developer Portal:

1. Navigate to "Bot" tab
2. Scroll down to "Privileged Gateway Intents" (optional but recommended):
   - ✅ **Message Content Intent** (to read message content)
   - ⚠️ **Server Members Intent** (if you need member list access)
3. Scroll to "Bot Permissions" and select:
   - ✅ `Read Messages/View Channels` - See channels
   - ✅ `Send Messages` - Post messages
   - ✅ `Manage Messages` - Delete/pin messages
   - ✅ `Read Message History` - Access past messages
   - ✅ `Add Reactions` - React to messages
   - ⚠️ `Administrator` - Full access (use sparingly)

### 3. Invite Bot to Your Server

1. In Discord Developer Portal, go to "OAuth2" → "URL Generator"
2. Select scopes:
   - ✅ `bot`
   - ✅ `applications.commands` (if using slash commands)
3. Select the same permissions as configured in Step 2
4. Copy the generated URL
5. Open the URL in your browser
6. Select the server to add the bot to
7. Click "Authorize"

### 4. Configure Environment Variable

#### Local Development

Add to `.env`:
```bash
DISCORD_TOKEN=your_discord_bot_token_here
```

#### Railway Deployment

1. Go to Railway project settings
2. Navigate to "Variables" tab
3. Add environment variable:
   - **Key:** `DISCORD_TOKEN`
   - **Value:** Your Discord bot token

### 5. Server Configuration

The Discord server is already configured in `config/servers.json`:

```json
{
  "name": "discord",
  "description": "Discord integration for server management, message operations, and channel management",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "mcp-server-discord"],
    "env": {}
  },
  "rateLimits": {
    "requestsPerMinute": 20,
    "requestsPerDay": 2000
  }
}
```

The server automatically inherits the `DISCORD_TOKEN` from the parent process environment.

## Available Tools

The Discord MCP server provides these tools:

### Server Information

1. **`discord/get_server_info`**
   - Get detailed information about a Discord server
   - Parameters: `server_id` (required)

2. **`discord/list_channels`**
   - List all channels in a server
   - Parameters: `server_id` (required)

### Message Operations

3. **`discord/get_channel_messages`**
   - Get messages from a channel
   - Parameters: `channel_id` (required), `limit` (default: 50)

4. **`discord/send_message`**
   - Send a message to a channel
   - Parameters: `channel_id` (required), `content` (required)

5. **`discord/delete_message`**
   - Delete a specific message
   - Parameters: `channel_id` (required), `message_id` (required)

6. **`discord/edit_message`**
   - Edit an existing message
   - Parameters: `channel_id` (required), `message_id` (required), `content` (required)

### Forum Operations

7. **`discord/get_forum_posts`**
   - Get posts from a forum channel
   - Parameters: `channel_id` (required)

8. **`discord/create_forum_post`**
   - Create a new forum post
   - Parameters: `channel_id` (required), `title` (required), `content` (required)

### Channel Management

9. **`discord/create_channel`**
   - Create a new channel
   - Parameters: `server_id` (required), `name` (required), `type` (text/voice/category)

10. **`discord/delete_channel`**
    - Delete a channel
    - Parameters: `channel_id` (required)

### Webhook Operations

11. **`discord/create_webhook`**
    - Create a webhook for a channel
    - Parameters: `channel_id` (required), `name` (required)

12. **`discord/send_webhook_message`**
    - Send a message via webhook
    - Parameters: `webhook_url` (required), `content` (required)

### Reactions

13. **`discord/add_reaction`**
    - Add a reaction to a message
    - Parameters: `channel_id` (required), `message_id` (required), `emoji` (required)

14. **`discord/remove_reaction`**
    - Remove a reaction from a message
    - Parameters: `channel_id` (required), `message_id` (required), `emoji` (required)

## Usage Examples

### Get Server Information

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/discord/get_server_info/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "server_id": "123456789012345678"
    }
  }'
```

### List Channels

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/discord/list_channels/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "server_id": "123456789012345678"
    }
  }'
```

### Get Channel Messages

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/discord/get_channel_messages/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "channel_id": "987654321098765432",
      "limit": 100
    }
  }'
```

### Send a Message

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/discord/send_message/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "channel_id": "987654321098765432",
      "content": "Hello from MCP Connect!"
    }
  }'
```

### Create Forum Post

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/discord/create_forum_post/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "channel_id": "987654321098765432",
      "title": "New Discussion Topic",
      "content": "Let'\''s discuss this important topic!"
    }
  }'
```

### Add Reaction to Message

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/discord/add_reaction/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "channel_id": "987654321098765432",
      "message_id": "111222333444555666",
      "emoji": "👍"
    }
  }'
```

### Create Webhook

```bash
curl -X POST https://mcp-connect-production.up.railway.app/api/tools/discord/create_webhook/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "channel_id": "987654321098765432",
      "name": "MCP Notifications"
    }
  }'
```

## Finding Discord IDs

### Enable Developer Mode

1. Open Discord
2. Go to User Settings (gear icon)
3. Navigate to "Advanced" under "App Settings"
4. Enable "Developer Mode"

### Get Server ID

1. Right-click on the server icon
2. Click "Copy Server ID"

### Get Channel ID

1. Right-click on any channel
2. Click "Copy Channel ID"

### Get Message ID

1. Right-click on any message
2. Click "Copy Message ID"

### Get User ID

1. Right-click on any user
2. Click "Copy User ID"

## Troubleshooting

### "Invalid authentication" Error

**Cause:** Missing or invalid Discord bot token

**Solution:**
1. Verify `DISCORD_TOKEN` is set in environment
2. Check token is correct (reset if needed in Discord Developer Portal)
3. Ensure bot token format is correct (not the client secret)
4. Restart MCP Connect server after adding token

### "Missing Permissions" Error

**Cause:** Bot lacks required permissions in the server

**Solution:**
1. Check bot role has necessary permissions
2. Verify channel-specific permissions aren't blocking the bot
3. Use Discord Developer Portal to regenerate invite with correct permissions
4. Re-invite bot to server

### "Unknown Channel/Server" Error

**Cause:** Bot doesn't have access to the channel/server or ID is invalid

**Solution:**
1. Verify the bot has been invited to the server
2. Check the channel/server ID is correct
3. Ensure bot can see the channel (check channel permissions)
4. For private channels, verify bot has explicit access

### "Cannot send messages" Error

**Cause:** Bot lacks permission to send messages in the channel

**Solution:**
1. Check bot has "Send Messages" permission
2. Verify channel isn't read-only for the bot's role
3. Check if channel has specific permission overrides blocking the bot
4. Ensure bot's role is higher than restricted roles

### Messages Not Readable

**Cause:** Message Content Intent not enabled

**Solution:**
1. Go to Discord Developer Portal → Your App → Bot
2. Enable "Message Content Intent" under Privileged Gateway Intents
3. If your bot is in 100+ servers, you may need verification
4. Restart MCP Connect server

### Discord Server Not Connecting

**Symptoms:** Health endpoint shows discord server as disconnected

**Solutions:**
1. Verify `DISCORD_TOKEN` is set in environment
2. Check Railway environment variables (for production)
3. Test token validity by checking bot status in Discord
4. Check Railway deployment logs for connection errors
5. Ensure `mcp-server-discord` package can be installed via npx

## Security Notes

1. **Token Security**
   - Never commit bot tokens to git
   - Add `.env` to `.gitignore`
   - Use environment variables only
   - Rotate tokens if compromised

2. **Bot Permissions**
   - Only grant necessary permissions
   - Avoid "Administrator" unless absolutely needed
   - Use role-based permissions
   - Regularly audit bot access

3. **Production Security**
   - Store token in Railway environment variables
   - Use separate bots for dev/prod
   - Monitor bot activity in Discord audit log
   - Enable 2FA on Discord account

4. **Revoke Compromised Tokens**
   - If token is exposed, reset immediately in Discord Developer Portal
   - Update environment variables with new token
   - Check audit log for unauthorized actions
   - Notify server admins if needed

5. **Rate Limiting**
   - Discord has strict rate limits
   - MCP Connect enforces 20 requests/minute
   - Exceeding limits may temporarily ban your bot
   - Use batch operations when possible

## Best Practices

1. **Bot Naming**
   - Use clear, descriptive bot names
   - Add "[Bot]" suffix for clarity
   - Use appropriate avatar/icon

2. **Message Etiquette**
   - Don't spam channels
   - Respect server rules
   - Use webhooks for automated messages
   - Delete error messages promptly

3. **Channel Organization**
   - Create dedicated bot channels
   - Use categories for organization
   - Set appropriate channel permissions
   - Archive unused channels

4. **Monitoring**
   - Check bot status regularly
   - Monitor API usage
   - Review error logs
   - Track rate limit warnings

## Package Information

- **Package:** `mcp-server-discord`
- **Version:** 1.2.8
- **License:** MIT
- **Repository:** https://www.npmjs.com/package/mcp-server-discord

## Additional Resources

- [Discord Developer Portal](https://discord.com/developers/applications)
- [Discord API Documentation](https://discord.com/developers/docs/intro)
- [Discord Bot Best Practices](https://discord.com/developers/docs/topics/community-resources#bots-and-apps)
- [Discord Permission Calculator](https://discordapi.com/permissions.html)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
