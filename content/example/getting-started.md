---
title: Getting Started
---

# Getting Started

Welcome to [**markdown-confluence**](https://github.com/NoOverflow/markdown-confluence)! This tool converts your markdown files to Confluence Storage Format and publishes them automatically.

## Prerequisites

- Node.js 18+
- A Confluence Cloud or self-hosted instance
- An API token (Confluence Cloud) or password/PAT (self-hosted)

## Installation

```bash
npm install
npm run build
```

## Configuration

Create a `.markdown-confluence.json` file in your project root:

```json
{
  "baseUrl": "https://yoursite.atlassian.net",
  "username": "your@email.com",
  "apiToken": "your-api-token",
  "spaceKey": "ENG",
  "parentPageId": "123456789"
}
```

## Publishing

```bash
npx markdown-confluence publish
```

Use `--dry-run` to preview what would be published without making any API calls:

```bash
npx markdown-confluence publish --dry-run
```

## Content Structure

Organize your markdown files under the `content/` directory. Folders become parent pages:

```
content/
  getting-started.md   → "Getting Started" page
  guides/
    index.md           → "Guides" page (folder page)
    setup.md           → "Setup" child page
    deployment.md      → "Deployment" child page
```

> **Tip:** Name a file `index.md` inside a folder to use it as the folder's page content.

## Supported Markdown Features

| Feature | Status |
|---------|--------|
| Headings | ✅ |
| Bold / Italic | ✅ |
| Code blocks (with language) | ✅ |
| Tables | ✅ |
| Links | ✅ |
| Images | ✅ |
| Blockquotes | ✅ |
| Lists (ordered & unordered) | ✅ |
| Strikethrough | ✅ |
| Frontmatter (title) | ✅ |
