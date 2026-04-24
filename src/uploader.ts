import axios, { AxiosInstance } from "axios";
import * as fs from "fs";
import * as path from "path";
import { Config } from "./config.js";
import { convertMarkdown } from "./converter.js";

export interface PageNode {
  /** Absolute path to the file or folder */
  fsPath: string;
  /** Display name / page title (derived from filename or frontmatter) */
  title: string;
  /** Confluence page ID once created/found */
  confluenceId?: string;
  children: PageNode[];
  /** undefined = folder-only node (no .md file), string = path to .md file */
  markdownFile?: string;
}

const CANDIDATE_API_PATHS = ["/wiki/rest/api", "/rest/api"];

export class ConfluenceUploader {
  private client: AxiosInstance;
  private apiBase = "/wiki/rest/api";

  constructor(private config: Config) {
    this.client = axios.create({
      baseURL: config.baseUrl.replace(/\/$/, ""),
      headers: {
        ...buildAuthHeaders(config),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      // Never follow redirects — SSO-protected instances redirect to a login
      // page on auth failure, which axios would silently follow to a 200 HTML
      // response. We want the raw 3xx/401 so we can surface a useful error.
      maxRedirects: 0,
      validateStatus: (status) => status < 300,
    });

    // Intercept auth failures and emit a clear, actionable message
    this.client.interceptors.response.use(undefined, (err) => {
      const status: number | undefined = err?.response?.status;
      if (status === 401 || status === 403 || (status && status >= 300 && status < 400)) {
        const hint =
          config.authMethod === "basic"
            ? `Check your username and apiToken. For SSO-protected instances, try authMethod "pat" or "cookie".`
            : config.authMethod === "pat"
            ? `Check that your Personal Access Token is valid and not expired.`
            : `Your session cookies may have expired. Log in again and update apiToken in the config.`;
        throw new Error(
          `Authentication failed (HTTP ${status ?? "redirect"}).\n${hint}`
        );
      }
      throw err;
    });
  }

  private async detectApiBase(): Promise<string> {
    for (const candidate of CANDIDATE_API_PATHS) {
      const response = await this.client.get(`${candidate}/space`, {
        params: { limit: 1 },
        validateStatus: (s) => s < 400,
      });
      if (response.status === 200) {
        console.log(`Detected API path: ${candidate}`);
        return candidate;
      }
    }
    throw new Error(
      `Could not find the Confluence REST API. Tried: ${CANDIDATE_API_PATHS.join(", ")}.\n` +
      `Check that baseUrl is correct and your credentials are valid.`
    );
  }

  async publish(dryRun = false): Promise<void> {
    const contentDir = path.resolve(process.cwd(), this.config.contentDir);
    if (!fs.existsSync(contentDir)) {
      throw new Error(`Content directory not found: ${contentDir}`);
    }

    if (!dryRun) {
      this.apiBase = await this.detectApiBase();
    }

    console.log(`Scanning ${contentDir} ...`);
    const tree = buildPageTree(contentDir);

    if (tree.length === 0) {
      console.log("No markdown files found.");
      return;
    }

    for (const node of tree) {
      await this.publishNode(node, this.config.parentPageId, dryRun);
    }
  }

  private async publishNode(
    node: PageNode,
    parentId: string,
    dryRun: boolean
  ): Promise<void> {
    let pageId: string;

    if (node.markdownFile) {
      const raw = fs.readFileSync(node.markdownFile, "utf-8");
      const { title, body } = convertMarkdown(raw, node.title);
      node.title = title;

      if (dryRun) {
        console.log(`[dry-run] Would publish: "${title}" (parent: ${parentId})`);
        pageId = `dry-run-${node.title}`;
      } else {
        pageId = await this.upsertPage(title, body, parentId);
        console.log(`Published: "${title}" → page ID ${pageId}`);
      }
    } else {
      // Folder node — create a blank container page
      if (dryRun) {
        console.log(`[dry-run] Would create folder page: "${node.title}" (parent: ${parentId})`);
        pageId = `dry-run-${node.title}`;
      } else {
        pageId = await this.upsertPage(node.title, "", parentId);
        console.log(`Created folder page: "${node.title}" → page ID ${pageId}`);
      }
    }

    node.confluenceId = pageId;

    for (const child of node.children) {
      await this.publishNode(child, pageId, dryRun);
    }
  }

  private async upsertPage(
    title: string,
    body: string,
    parentId: string
  ): Promise<string> {
    const existing = await this.findPage(title, parentId);

    if (existing) {
      await this.updatePage(existing.id, title, body, existing.version);
      return existing.id;
    }

    return this.createPage(title, body, parentId);
  }

  private async findPage(
    title: string,
    parentId: string
  ): Promise<{ id: string; version: number } | null> {
    const response = await this.client.get(`${this.apiBase}/content`, {
      params: {
        title,
        spaceKey: this.config.spaceKey,
        expand: "version",
      },
    });

    const results: ConfluencePageResult[] = response.data?.results ?? [];
    const match = results.find((r) => r.ancestors?.some((a) => a.id === parentId));

    if (match) {
      return { id: match.id, version: match.version.number };
    }

    // Fall back to title-only match within the space if no ancestor match
    if (results.length === 1) {
      return { id: results[0].id, version: results[0].version.number };
    }

    return null;
  }

  private async createPage(
    title: string,
    body: string,
    parentId: string
  ): Promise<string> {
    const response = await this.client.post(`${this.apiBase}/content`, {
      type: "page",
      title,
      space: { key: this.config.spaceKey },
      ancestors: [{ id: parentId }],
      body: {
        storage: {
          value: body,
          representation: "storage",
        },
      },
    });
    return response.data.id as string;
  }

  private async updatePage(
    pageId: string,
    title: string,
    body: string,
    currentVersion: number
  ): Promise<void> {
    await this.client.put(`${this.apiBase}/content/${pageId}`, {
      type: "page",
      title,
      body: {
        storage: {
          value: body,
          representation: "storage",
        },
      },
      version: { number: currentVersion + 1 },
    });
  }
}

// ---------------------------------------------------------------------------
// File-system tree builder
// ---------------------------------------------------------------------------

function buildPageTree(dir: string): PageNode[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const nodes: PageNode[] = [];

  const mdFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name);

  const subdirs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  // Each .md file becomes a page node
  for (const filename of mdFiles) {
    const fsPath = path.join(dir, filename);
    const baseName = filename.replace(/\.md$/, "");
    nodes.push({
      fsPath,
      title: titleFromFilename(baseName),
      markdownFile: fsPath,
      children: [],
    });
  }

  // Each subdirectory becomes a folder page with children
  for (const subdir of subdirs) {
    const subdirPath = path.join(dir, subdir);
    const children = buildPageTree(subdirPath);
    if (children.length === 0) continue; // skip empty directories

    // If there's an index.md inside the folder, use it as the folder page content
    const indexNode = children.find(
      (c) => c.markdownFile?.endsWith("index.md")
    );

    if (indexNode) {
      indexNode.title = titleFromFilename(subdir);
      indexNode.children = children.filter((c) => c !== indexNode);
      nodes.push(indexNode);
    } else {
      nodes.push({
        fsPath: subdirPath,
        title: titleFromFilename(subdir),
        children,
      });
    }
  }

  return nodes;
}

function titleFromFilename(name: string): string {
  return name
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

function buildAuthHeaders(config: Config): Record<string, string> {
  const headers: Record<string, string> = {};

  switch (config.authMethod) {
    case "basic": {
      const encoded = Buffer.from(
        `${config.username}:${config.apiToken}`
      ).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
      break;
    }
    case "pat":
      headers["Authorization"] = `Bearer ${config.apiToken}`;
      break;
    case "cookie":
      headers["Cookie"] = config.apiToken;
      break;
  }

  // Merge the OIDC/SSO proxy session cookie when present.
  // This lets PAT or Basic auth handle Confluence while the session cookie
  // satisfies the proxy sitting in front of it.
  if (config.sessionCookie) {
    const existing = headers["Cookie"];
    headers["Cookie"] = existing
      ? `${existing}; ${config.sessionCookie}`
      : config.sessionCookie;
  }

  return headers;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ConfluencePageResult {
  id: string;
  title: string;
  version: { number: number };
  ancestors?: Array<{ id: string }>;
}
