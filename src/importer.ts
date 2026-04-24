import axios, { AxiosInstance } from "axios";
import * as fs from "fs";
import * as path from "path";
import { Config } from "./config.js";
import { confluenceStorageToMarkdown, collectAttachmentFilenames } from "./confluence-to-markdown.js";
import { buildAuthHeaders, authErrorMessage } from "./auth.js";

interface ConfluencePage {
  id: string;
  title: string;
  body?: { storage: { value: string } };
  children?: { page: { results: ConfluencePage[] } };
}

const CANDIDATE_API_PATHS = ["/wiki/rest/api", "/rest/api"];

export class ConfluenceImporter {
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
      maxRedirects: 0,
      validateStatus: (status) => status < 300,
    });

    this.client.interceptors.response.use(undefined, (err) => {
      const status: number | undefined = err?.response?.status;
      if (status === 401 || status === 403 || (status && status >= 300 && status < 400)) {
        throw new Error(authErrorMessage(config, status));
      }
      throw err;
    });
  }

  async pull(dryRun = false): Promise<void> {
    this.apiBase = await this.detectApiBase();

    const contentDir = path.resolve(process.cwd(), this.config.contentDir);
    if (!dryRun) {
      fs.mkdirSync(contentDir, { recursive: true });
    }

    console.log(`Fetching children of page ${this.config.parentPageId} ...`);
    const rootPages = await this.fetchChildren(this.config.parentPageId);

    for (const page of rootPages) {
      await this.importPage(page, contentDir, dryRun);
    }
  }

  private async importPage(
    page: ConfluencePage,
    dir: string,
    dryRun: boolean
  ): Promise<void> {
    const children = await this.fetchChildren(page.id);
    const hasChildren = children.length > 0;
    const filename = filenameFromTitle(page.title);

    if (hasChildren) {
      // Page with children → folder + index.md
      const folderPath = path.join(dir, filename);
      const filePath = path.join(folderPath, "index.md");
      const { markdown, storage } = await this.pageToMarkdown(page);

      if (dryRun) {
        console.log(`[dry-run] Would write: ${filePath}`);
        await this.downloadAttachments(page.id, storage, folderPath, dryRun);
      } else {
        fs.mkdirSync(folderPath, { recursive: true });
        fs.writeFileSync(filePath, markdown, "utf-8");
        console.log(`Written: ${filePath}`);
        await this.downloadAttachments(page.id, storage, folderPath, dryRun);
      }

      for (const child of children) {
        await this.importPage(child, folderPath, dryRun);
      }
    } else {
      // Leaf page → <filename>.md, assets go in same directory
      const filePath = path.join(dir, `${filename}.md`);
      const { markdown, storage } = await this.pageToMarkdown(page);

      if (dryRun) {
        console.log(`[dry-run] Would write: ${filePath}`);
        await this.downloadAttachments(page.id, storage, dir, dryRun);
      } else {
        fs.writeFileSync(filePath, markdown, "utf-8");
        console.log(`Written: ${filePath}`);
        await this.downloadAttachments(page.id, storage, dir, dryRun);
      }
    }
  }

  private async pageToMarkdown(
    page: ConfluencePage
  ): Promise<{ markdown: string; storage: string }> {
    let storage: string = page.body?.storage?.value ?? "";

    if (!storage) {
      const response = await this.client.get(
        `${this.apiBase}/content/${page.id}`,
        { params: { expand: "body.storage" } }
      );
      storage = response.data?.body?.storage?.value ?? "";
    }

    return {
      markdown: confluenceStorageToMarkdown(storage, page.title),
      storage,
    };
  }

  private async downloadAttachments(
    pageId: string,
    storageBody: string,
    pageDir: string,
    dryRun: boolean
  ): Promise<void> {
    // Only download attachments that are actually referenced in the page body
    const referenced = new Set(collectAttachmentFilenames(storageBody));
    if (referenced.size === 0) return;

    const assetsDir = path.join(pageDir, "assets");
    const attachments = await this.fetchAttachments(pageId);
    const toDownload = attachments.filter((a) => referenced.has(a.title));

    if (toDownload.length === 0) return;

    if (dryRun) {
      for (const a of toDownload) {
        console.log(`[dry-run] Would download asset: ${path.join(assetsDir, a.title)}`);
      }
      return;
    }

    fs.mkdirSync(assetsDir, { recursive: true });

    for (const attachment of toDownload) {
      const destPath = path.join(assetsDir, attachment.title);
      const response = await this.client.get(attachment.downloadUrl, {
        responseType: "arraybuffer",
      });
      fs.writeFileSync(destPath, Buffer.from(response.data as ArrayBuffer));
      console.log(`  Downloaded asset: ${destPath}`);
    }
  }

  private async fetchAttachments(
    pageId: string
  ): Promise<Array<{ title: string; downloadUrl: string }>> {
    const attachments: Array<{ title: string; downloadUrl: string }> = [];
    let start = 0;
    const limit = 50;

    while (true) {
      const response = await this.client.get(
        `${this.apiBase}/content/${pageId}/child/attachment`,
        { params: { limit, start } }
      );
      const results: Array<{ title: string; _links: { download: string } }> =
        response.data?.results ?? [];

      for (const r of results) {
        if (r._links?.download) {
          attachments.push({ title: r.title, downloadUrl: r._links.download });
        }
      }

      if (results.length < limit) break;
      start += limit;
    }

    return attachments;
  }

  private async fetchChildren(pageId: string): Promise<ConfluencePage[]> {
    const pages: ConfluencePage[] = [];
    let start = 0;
    const limit = 50;

    while (true) {
      const response = await this.client.get(
        `${this.apiBase}/content/${pageId}/child/page`,
        { params: { expand: "body.storage", limit, start } }
      );

      const results: ConfluencePage[] = response.data?.results ?? [];
      pages.push(...results);

      if (results.length < limit) break;
      start += limit;
    }

    return pages;
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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function filenameFromTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

