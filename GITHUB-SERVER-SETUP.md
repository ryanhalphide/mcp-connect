# GitHub MCP Server Setup

## Overview

The GitHub MCP server (`@iflow-mcp/server-github`) provides comprehensive GitHub API integration, enabling repository management, file operations, issue tracking, pull request management, and more.

## Configuration

### 1. Get a GitHub Personal Access Token

1. Go to https://github.com/settings/tokens
2. Click "Generate new token" → "Generate new token (classic)"
3. Give it a descriptive name (e.g., "MCP Connect Server")
4. Select required scopes:
   - ✅ `repo` - Full control of private repositories
   - ✅ `read:org` - Read organization membership
   - ✅ `read:user` - Read user profile data
   - ⚠️ `workflow` (optional) - Update GitHub Action workflows
5. Click "Generate token"
6. **Copy the token immediately** (you won't see it again!)

### 2. Configure Environment Variable

#### Local Development

Add to `.env`:
```bash
GITHUB_PERSONAL_ACCESS_TOKEN=ghp_your_token_here
```

#### Railway Deployment

1. Go to Railway project settings
2. Navigate to "Variables" tab
3. Add environment variable:
   - **Key:** `GITHUB_PERSONAL_ACCESS_TOKEN`
   - **Value:** Your GitHub token

### 3. Server Configuration

The GitHub server is already configured in `config/servers.json`:

```json
{
  "name": "github",
  "description": "GitHub API integration for repository management, file operations, issues, and pull requests",
  "transport": {
    "type": "stdio",
    "command": "npx",
    "args": ["-y", "@iflow-mcp/server-github"],
    "env": {}
  },
  "rateLimits": {
    "requestsPerMinute": 30,
    "requestsPerDay": 5000
  }
}
```

The server automatically inherits the `GITHUB_PERSONAL_ACCESS_TOKEN` from the parent process environment.

## Available Tools

The GitHub MCP server provides these tools:

### Repository Management

1. **`github/create_repository`**
   - Create a new GitHub repository
   - Parameters: `name`, `description`, `private`, `autoInit`

2. **`github/fork_repository`**
   - Fork an existing repository
   - Parameters: `owner`, `repo`, `organization`

3. **`github/search_repositories`**
   - Search for repositories
   - Parameters: `query`, `page`, `perPage`

### File Operations

4. **`github/get_file_contents`**
   - Get contents of a file or directory
   - Parameters: `owner`, `repo`, `path`, `branch`

5. **`github/create_or_update_file`**
   - Create or update a single file
   - Parameters: `owner`, `repo`, `path`, `content`, `message`, `branch`, `sha`

6. **`github/push_files`**
   - Push multiple files in a single commit
   - Parameters: `owner`, `repo`, `branch`, `files`, `message`

### Issue Management

7. **`github/create_issue`**
   - Create a new issue
   - Parameters: `owner`, `repo`, `title`, `body`, `assignees`, `labels`, `milestone`

8. **`github/list_issues`**
   - List repository issues
   - Parameters: `owner`, `repo`, `state`, `labels`, `assignee`

9. **`github/update_issue`**
   - Update an existing issue
   - Parameters: `owner`, `repo`, `issue_number`, `title`, `body`, `state`

### Pull Request Management

10. **`github/create_pull_request`**
    - Create a new pull request
    - Parameters: `owner`, `repo`, `title`, `body`, `head`, `base`, `draft`

11. **`github/list_pull_requests`**
    - List repository pull requests
    - Parameters: `owner`, `repo`, `state`, `head`, `base`

12. **`github/merge_pull_request`**
    - Merge a pull request
    - Parameters: `owner`, `repo`, `pull_number`, `merge_method`

### Branch Operations

13. **`github/create_branch`**
    - Create a new branch
    - Parameters: `owner`, `repo`, `branch`, `from_branch`

14. **`github/list_branches`**
    - List repository branches
    - Parameters: `owner`, `repo`

### Other Tools

15. **`github/search_code`**
    - Search code across repositories
    - Parameters: `query`, `page`, `perPage`

16. **`github/search_issues`**
    - Search issues and pull requests
    - Parameters: `query`, `page`, `perPage`

17. **`github/search_users`**
    - Search for users
    - Parameters: `query`, `page`, `perPage`

## Usage Examples

### Create a Repository

```bash
curl -X POST http://localhost:3000/api/tools/github/create_repository/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "name": "my-new-repo",
      "description": "Created via MCP Connect",
      "private": false,
      "autoInit": true
    }
  }'
```

### Get File Contents

```bash
curl -X POST http://localhost:3000/api/tools/github/get_file_contents/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "owner": "octocat",
      "repo": "Hello-World",
      "path": "README.md"
    }
  }'
```

### Create an Issue

```bash
curl -X POST http://localhost:3000/api/tools/github/create_issue/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "owner": "myuser",
      "repo": "myrepo",
      "title": "Bug: Something is broken",
      "body": "Detailed description of the issue",
      "labels": ["bug", "high-priority"]
    }
  }'
```

### Create a Pull Request

```bash
curl -X POST http://localhost:3000/api/tools/github/create_pull_request/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "owner": "myuser",
      "repo": "myrepo",
      "title": "Add new feature",
      "body": "This PR adds amazing functionality",
      "head": "feature-branch",
      "base": "main"
    }
  }'
```

### Push Multiple Files

```bash
curl -X POST http://localhost:3000/api/tools/github/push_files/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "owner": "myuser",
      "repo": "myrepo",
      "branch": "main",
      "files": [
        {
          "path": "src/index.js",
          "content": "console.log(\"Hello World\");"
        },
        {
          "path": "README.md",
          "content": "# My Project\n\nAwesome project!"
        }
      ],
      "message": "Initial commit via MCP"
    }
  }'
```

### Search Code

```bash
curl -X POST http://localhost:3000/api/tools/github/search_code/invoke \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "params": {
      "query": "model context protocol language:typescript"
    }
  }'
```

## Troubleshooting

### "Authentication required" Error

**Cause:** Missing or invalid GitHub token

**Solution:**
1. Verify `GITHUB_PERSONAL_ACCESS_TOKEN` is set in environment
2. Check token hasn't expired
3. Ensure token has required scopes
4. Restart MCP Connect server after adding token

### "Resource not accessible by integration" Error

**Cause:** Token lacks required permissions

**Solution:**
1. Go to https://github.com/settings/tokens
2. Click on your token
3. Add missing scopes (likely `repo`)
4. Update environment variable with new token
5. Restart server

### "Rate limit exceeded" Error

**Cause:** GitHub API rate limits reached

**Solution:**
1. Authenticated requests allow 5,000 requests/hour
2. Wait for rate limit reset
3. Check rate limit status in response headers
4. Consider implementing caching for repeated requests

### GitHub Server Not Connecting

**Symptoms:** Health endpoint shows github server as disconnected

**Solutions:**
1. Verify `GITHUB_PERSONAL_ACCESS_TOKEN` is set
2. Check Railway environment variables (for production)
3. Test token validity: `curl -H "Authorization: token YOUR_TOKEN" https://api.github.com/user`
4. Check Railway deployment logs for connection errors
5. Ensure `@iflow-mcp/server-github` package can be installed via npx

## Security Notes

1. **Never commit tokens to git**
   - Add `.env` to `.gitignore`
   - Use environment variables only

2. **Token Scope Principle**
   - Only grant necessary permissions
   - Use fine-grained tokens when possible
   - Rotate tokens regularly

3. **Production Security**
   - Store token in Railway environment variables
   - Use separate tokens for dev/prod
   - Monitor token usage in GitHub settings

4. **Revoke Compromised Tokens**
   - If token is exposed, revoke immediately
   - Generate new token with same scopes
   - Update environment variables

## Package Information

- **Package:** `@iflow-mcp/server-github`
- **Version:** 0.6.2
- **License:** MIT
- **Repository:** https://www.npmjs.com/package/@iflow-mcp/server-github

## Additional Resources

- [GitHub Personal Access Tokens Documentation](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token)
- [GitHub REST API Documentation](https://docs.github.com/en/rest)
- [MCP Protocol Specification](https://modelcontextprotocol.io)
