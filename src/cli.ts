#!/usr/bin/env node
import { Command } from "commander";
import { loadConfig } from "./config.js";
import { ConfluenceUploader } from "./uploader.js";
import { convertMarkdown } from "./converter.js";
import * as fs from "fs";
import * as path from "path";

const program = new Command();

program
  .name("markdown-confluence")
  .description("Convert markdown files to Confluence Storage Format and publish them")
  .version("0.1.0");

program
  .command("publish")
  .description("Publish the content directory to Confluence")
  .option("--dry-run", "Print what would be published without making API calls")
  .option("--base-url <url>", "Confluence base URL (overrides config)")
  .option("--auth-method <method>", "Auth method: basic, pat, or cookie (overrides config)")
  .option("--username <username>", "Confluence username / email (overrides config)")
  .option("--api-token <token>", "API token, PAT, or cookie string (overrides config)")
  .option("--session-cookie <cookie>", "OIDC/SSO proxy session cookie, sent alongside primary auth (overrides config)")
  .option("--space-key <key>", "Confluence space key (overrides config)")
  .option("--parent-page-id <id>", "Parent page ID (overrides config)")
  .option("--content-dir <dir>", "Path to content directory (overrides config)")
  .action(async (opts) => {
    try {
      const config = loadConfig({
        baseUrl: opts.baseUrl,
        authMethod: opts.authMethod,
        username: opts.username,
        apiToken: opts.apiToken,
        sessionCookie: opts.sessionCookie,
        spaceKey: opts.spaceKey,
        parentPageId: opts.parentPageId,
        contentDir: opts.contentDir,
      });

      const uploader = new ConfluenceUploader(config);
      await uploader.publish(opts.dryRun ?? false);
    } catch (err) {
      console.error("Error:", (err as Error).message);
      process.exit(1);
    }
  });

program
  .command("convert <file>")
  .description("Convert a single markdown file to Confluence Storage Format and print the result")
  .action((file: string) => {
    const filePath = path.resolve(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    const raw = fs.readFileSync(filePath, "utf-8");
    const fallbackTitle = path.basename(file, ".md");
    const { title, body } = convertMarkdown(raw, fallbackTitle);
    console.log(`<!-- Title: ${title} -->`);
    console.log(body);
  });

program.parse(process.argv);
