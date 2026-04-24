# markdown-confluence

Convert a folder of markdown files to Confluence Storage Format and publish them to Confluence Cloud or self-hosted Confluence instances.

## Features

- Mirrors your folder structure as a Confluence page hierarchy
- Converts markdown to Confluence Storage Format (headings, bold/italic, code blocks with language, tables, links, images, blockquotes, lists, strikethrough)
- Upserts pages — creates new ones, updates existing ones by title
- Supports frontmatter `title` field to override the page title
- `index.md` inside a folder becomes that folder's page content
- Auto-detects the Confluence REST API base path (`/wiki/rest/api` or `/rest/api`)
- Three auth methods: Basic, Personal Access Token (PAT), Cookie
- Optional `sessionCookie` to pass through an OIDC/SSO proxy sitting in front of Confluence

## Installation

```bash
npm install
npm run build
```

## Usage

```bash
# Publish content/ to Confluence
node dist/cli.js publish

# Preview what would be published without making API calls
node dist/cli.js publish --dry-run

# Convert a single file and print the Confluence Storage Format XML
node dist/cli.js convert content/example/getting-started.md
```

Any option can be overridden on the command line:

```bash
node dist/cli.js publish --content-dir ./docs --space-key ENG
```

Run `node dist/cli.js publish --help` for the full list of flags.

## Content structure

Organise your markdown files under the `content/` directory (or whichever path you set in `contentDir`). Folders become parent pages; `.md` files become child pages.

```
content/
  getting-started.md        → "Getting Started" page
  guides/
    index.md                → "Guides" page  (folder's own content)
    setup.md                → "Setup" child page
    deployment.md           → "Deployment" child page
  reference/
    api.md                  → "Api" child page
```

- A folder with no `index.md` becomes a blank container page.
- A folder with an `index.md` uses that file as its own page content; the other files in the folder become its children.
- Page titles are derived from the filename (`getting-started.md` → `Getting Started`) or from the `title` field in the file's frontmatter.

```markdown
---
title: My Custom Page Title
---

# Content starts here
```

## Configuration

Create a `.markdown-confluence.json` file in your project root. Copy one of the provided example files as a starting point:

| Example file | Scenario |
|---|---|
| [.markdown-confluence.cloud.example.json](.markdown-confluence.cloud.example.json) | Confluence Cloud (Basic auth) |
| [.markdown-confluence.selfhosted-pat.example.json](.markdown-confluence.selfhosted-pat.example.json) | Self-hosted — Personal Access Token |
| [.markdown-confluence.selfhosted-sso.example.json](.markdown-confluence.selfhosted-sso.example.json) | Self-hosted behind an OIDC/SSO proxy — PAT + session cookie |
| [.markdown-confluence.selfhosted-cookie.example.json](.markdown-confluence.selfhosted-cookie.example.json) | Self-hosted — Cookie-only auth |

All fields can also be provided as environment variables (see below).

### Confluence Cloud (Basic auth)

The standard setup for Atlassian-hosted Confluence (`*.atlassian.net`).

```json
{
  "baseUrl": "https://yourorg.atlassian.net",
  "authMethod": "basic",
  "username": "your@email.com",
  "apiToken": "your-api-token",
  "spaceKey": "ENG",
  "parentPageId": "123456789",
  "contentDir": "./content"
}
```

Generate an API token at: **Atlassian Account Settings → Security → API tokens**

---

### Self-hosted Confluence — Personal Access Token (recommended)

PATs are supported on Confluence Server and Data Center 7.9+. They work even when SSO is configured, and they never expire unless you revoke them.

```json
{
  "baseUrl": "https://confluence.yourcompany.com",
  "authMethod": "pat",
  "apiToken": "your-personal-access-token",
  "spaceKey": "ENG",
  "parentPageId": "123456789",
  "contentDir": "./content"
}
```

Generate a PAT at: **Confluence → Profile → Personal Access Tokens → Create token**

---

### Self-hosted Confluence behind an OIDC/SSO proxy

When an SSO proxy (e.g. AWS ALB with OIDC, oauth2-proxy) sits in front of Confluence, every request must carry both the proxy's session cookie **and** a Confluence credential. Use `authMethod: "pat"` for the Confluence credential and `sessionCookie` for the proxy session.

```json
{
  "baseUrl": "https://confluence.yourcompany.com",
  "authMethod": "pat",
  "apiToken": "your-personal-access-token",
  "sessionCookie": "AWSELBAuthSessionCookie-0=<value>; AWSELBAuthSessionCookie-1=<value>; JSESSIONID=<value>",
  "spaceKey": "ENG",
  "parentPageId": "123456789",
  "contentDir": "./content"
}
```

**How to get your session cookies:**
1. Log in to Confluence via your browser (this triggers the SSO flow).
2. Open DevTools → **Application** tab (Chrome) or **Storage** tab (Firefox).
3. Navigate to **Cookies** → select your Confluence domain.
4. Copy the values for `AWSELBAuthSessionCookie-0`, `AWSELBAuthSessionCookie-1`, `JSESSIONID` (or whichever cookies your proxy uses).
5. Paste them as a single semicolon-separated string in `sessionCookie`.

> Session cookies expire when your browser session ends or after the proxy's configured TTL. Re-login and update `sessionCookie` when you start getting auth errors.

---

### Self-hosted Confluence — Cookie-only auth

If PATs are not available on your instance, you can authenticate using only the Confluence session cookie. Combine the proxy cookie and the Confluence session in `apiToken`.

```json
{
  "baseUrl": "https://confluence.yourcompany.com",
  "authMethod": "cookie",
  "apiToken": "JSESSIONID=<value>; AWSELBAuthSessionCookie-0=<value>; AWSELBAuthSessionCookie-1=<value>",
  "spaceKey": "ENG",
  "parentPageId": "123456789",
  "contentDir": "./content"
}
```

---

## Configuration reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `baseUrl` | ✅ | — | Base URL of your Confluence instance |
| `authMethod` | | `"basic"` | `"basic"`, `"pat"`, or `"cookie"` |
| `username` | ✅ (basic) | — | Email (Cloud) or username (self-hosted) |
| `apiToken` | ✅ | — | API token, PAT, or cookie string depending on `authMethod` |
| `sessionCookie` | | — | OIDC/SSO proxy session cookie, sent alongside `authMethod` auth |
| `spaceKey` | ✅ | — | Target Confluence space key, e.g. `"ENG"` |
| `parentPageId` | ✅ | — | ID of the parent page under which all content will be nested |
| `contentDir` | | `"./content"` | Path to the directory containing your markdown files |

### Finding `parentPageId`

Open the parent page in Confluence and look at the URL:
- Cloud: `https://yourorg.atlassian.net/wiki/spaces/ENG/pages/123456789/Page+Title` → ID is `123456789`
- Self-hosted: `https://confluence.yourcompany.com/pages/viewpage.action?pageId=123456789` → ID is `123456789`

### Environment variables

All config fields can be set via environment variables. CLI flags take precedence over env vars, which take precedence over the config file.

| Variable | Config field |
|----------|-------------|
| `CONFLUENCE_BASE_URL` | `baseUrl` |
| `CONFLUENCE_AUTH_METHOD` | `authMethod` |
| `CONFLUENCE_USERNAME` | `username` |
| `CONFLUENCE_API_TOKEN` | `apiToken` |
| `CONFLUENCE_SESSION_COOKIE` | `sessionCookie` |
| `CONFLUENCE_SPACE_KEY` | `spaceKey` |
| `CONFLUENCE_PARENT_PAGE_ID` | `parentPageId` |
| `CONFLUENCE_CONTENT_DIR` | `contentDir` |

## Supported Markdown features

| Feature | Notes |
|---------|-------|
| Headings (h1–h6) | |
| Bold, italic, strikethrough | |
| Code blocks | Language tag maps to Confluence `code` macro |
| Inline code | |
| Tables | GFM-style |
| Ordered and unordered lists | Nested lists supported |
| Links | |
| Images | External URLs and local filenames (treated as Confluence attachments) |
| Blockquotes | |
| Horizontal rules | |
| Frontmatter | `title` field overrides the page title |
| Raw HTML | Passed through as-is |
