import { parseDocument } from "htmlparser2";
import { Element, Text, Node, Document } from "domhandler";
import { getChildren, textContent } from "domutils";

export function confluenceStorageToMarkdown(
  storageFormat: string,
  title: string
): string {
  const doc = parseDocument(storageFormat, { xmlMode: true });
  const body = convertNodes(doc.children).trim();
  return `---\ntitle: ${title}\n---\n\n${body}\n`;
}

/** Returns every attachment filename referenced in a storage-format document. */
export function collectAttachmentFilenames(storageFormat: string): string[] {
  const doc = parseDocument(storageFormat, { xmlMode: true });
  const filenames: string[] = [];

  function walk(nodes: Node[]): void {
    for (const node of nodes) {
      if (node.type !== "tag") continue;
      const el = node as Element;
      if (el.name.toLowerCase() === "ri:attachment") {
        const name = el.attribs["ri:filename"];
        if (name) filenames.push(name);
      }
      if (el.children) walk(el.children);
    }
  }

  walk(doc.children);
  return filenames;
}

// ---------------------------------------------------------------------------
// Node dispatcher
// ---------------------------------------------------------------------------

function convertNodes(nodes: Node[]): string {
  return nodes.map(convertNode).join("");
}

function convertNode(node: Node): string {
  if (node.type === "text") {
    return decodeEntities((node as Text).data);
  }
  if (node.type !== "tag") return "";

  const el = node as Element;
  const name = el.name.toLowerCase();

  switch (name) {
    // Headings
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const level = parseInt(name[1]);
      return `\n${"#".repeat(level)} ${inline(el)}\n\n`;
    }

    // Block text
    case "p":
      return `\n${inline(el)}\n\n`;
    case "blockquote":
      return convertBlockquote(el);
    case "hr":
      return "\n---\n\n";
    case "br":
      return "\n";

    // Inline formatting
    case "strong":
    case "b":
      return `**${inline(el)}**`;
    case "em":
    case "i":
      return `*${inline(el)}*`;
    case "del":
    case "s":
      return `~~${inline(el)}~~`;
    case "code":
      return `\`${textContent(el)}\``;
    case "sup":
      return `^${inline(el)}^`;
    case "sub":
      return `~${inline(el)}~`;

    // Links
    case "a": {
      const href = el.attribs["href"] ?? "";
      const label = inline(el) || href;
      return `[${label}](${href})`;
    }

    // Lists
    case "ul":
      return `\n${convertList(el, false, 0)}\n`;
    case "ol":
      return `\n${convertList(el, true, 0)}\n`;
    case "li":
      // handled by convertList
      return inline(el);

    // Table
    case "table":
    case "tbody":
    case "thead":
      return convertTable(el);

    // Confluence macros / rich content
    case "ac:structured-macro":
      return convertMacro(el);
    case "ac:image":
      return convertAcImage(el);
    case "ac:link":
      return convertAcLink(el);
    case "ac:rich-text-body":
      return convertNodes(el.children);
    case "ac:plain-text-body":
      return textContent(el);
    // ac:parameter values are consumed by their parent macro handlers
    case "ac:parameter":
    case "ac:emoticon":
    case "ac:task-list":
    case "ac:task":
      return "";

    default:
      // Fall through: render children for unknown wrapper elements
      return convertNodes(el.children);
  }
}

// ---------------------------------------------------------------------------
// Inline helper — renders children and strips surrounding newlines
// ---------------------------------------------------------------------------

function inline(el: Element): string {
  return convertNodes(el.children).replace(/^\n+|\n+$/g, "");
}

// ---------------------------------------------------------------------------
// Blockquote
// ---------------------------------------------------------------------------

function convertBlockquote(el: Element): string {
  const inner = convertNodes(el.children).trim();
  const quoted = inner
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  return `\n${quoted}\n\n`;
}

// ---------------------------------------------------------------------------
// Lists (recursive for nesting)
// ---------------------------------------------------------------------------

function convertList(el: Element, ordered: boolean, depth: number): string {
  const indent = "  ".repeat(depth);
  let counter = 1;

  return el.children
    .filter((n): n is Element => n.type === "tag")
    .map((li) => {
      const bullet = ordered ? `${counter++}.` : "-";
      // Separate inline content from nested sub-lists
      const directText = li.children
        .filter(
          (n) =>
            !(
              n.type === "tag" &&
              ["ul", "ol"].includes((n as Element).name.toLowerCase())
            )
        )
        .map(convertNode)
        .join("")
        .replace(/^\n+|\n+$/g, "");

      const nested = li.children
        .filter(
          (n): n is Element =>
            n.type === "tag" &&
            ["ul", "ol"].includes((n as Element).name.toLowerCase())
        )
        .map((sub) =>
          convertList(sub, sub.name.toLowerCase() === "ol", depth + 1)
        )
        .join("");

      return `${indent}${bullet} ${directText}${nested ? `\n${nested}` : ""}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Table → GFM
// ---------------------------------------------------------------------------

function convertTable(el: Element): string {
  // Collect all rows from thead/tbody or directly from table
  const rows = collectRows(el);
  if (rows.length === 0) return "";

  const [headerRow, ...bodyRows] = rows;
  const widths = headerRow.map((c) => Math.max(c.length, 3));

  // Expand widths for body cells
  for (const row of bodyRows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 3, cell.length);
    });
  }

  const pad = (s: string, w: number) => s.padEnd(w);
  const renderRow = (cells: string[]) =>
    `| ${cells.map((c, i) => pad(c, widths[i] ?? c.length)).join(" | ")} |`;
  const separator = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;

  const lines = [
    renderRow(headerRow),
    separator,
    ...bodyRows.map(renderRow),
  ];

  return `\n${lines.join("\n")}\n\n`;
}

function collectRows(el: Element): string[][] {
  const rows: string[][] = [];

  for (const child of getChildren(el)) {
    if (child.type !== "tag") continue;
    const name = (child as Element).name.toLowerCase();

    if (name === "thead" || name === "tbody") {
      rows.push(...collectRows(child as Element));
    } else if (name === "tr") {
      const cells = getChildren(child)
        .filter(
          (n): n is Element =>
            n.type === "tag" &&
            ["th", "td"].includes((n as Element).name.toLowerCase())
        )
        .map((cell) => inline(cell).replace(/\|/g, "\\|"));
      if (cells.length) rows.push(cells);
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Confluence structured macros
// ---------------------------------------------------------------------------

function convertMacro(el: Element): string {
  const macroName = el.attribs["ac:name"] ?? "";

  switch (macroName) {
    case "code": {
      const lang = macroParam(el, "language") ?? "";
      const title = macroParam(el, "title");
      const body = macroBody(el, "plain-text-body");
      const titleComment = title ? ` ${title}` : "";
      return `\n\`\`\`${lang}${titleComment}\n${body}\n\`\`\`\n\n`;
    }

    case "info":
    case "note":
    case "warning":
    case "tip": {
      const body = macroBody(el, "rich-text-body");
      const label = macroName.toUpperCase();
      const lines = body
        .trim()
        .split("\n")
        .map((l) => `> ${l}`);
      return `\n> **${label}**\n${lines.join("\n")}\n\n`;
    }

    case "noformat": {
      const body = macroBody(el, "plain-text-body");
      return `\n\`\`\`\n${body}\n\`\`\`\n\n`;
    }

    default:
      // For unknown macros render whatever rich-text-body they contain
      return convertNodes(el.children);
  }
}

function macroParam(el: Element, paramName: string): string | undefined {
  for (const child of getChildren(el)) {
    if (
      child.type === "tag" &&
      (child as Element).name.toLowerCase() === "ac:parameter" &&
      (child as Element).attribs["ac:name"] === paramName
    ) {
      return textContent(child).trim();
    }
  }
  return undefined;
}

function macroBody(el: Element, bodyType: "plain-text-body" | "rich-text-body"): string {
  for (const child of getChildren(el)) {
    if (
      child.type === "tag" &&
      (child as Element).name.toLowerCase() === `ac:${bodyType}`
    ) {
      return bodyType === "plain-text-body"
        ? textContent(child)
        : convertNodes((child as Element).children).trim();
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Confluence images
// ---------------------------------------------------------------------------

function convertAcImage(el: Element): string {
  const altParam = macroParam(el, "alt") ?? "";

  for (const child of getChildren(el)) {
    if (child.type !== "tag") continue;
    const name = (child as Element).name.toLowerCase();
    if (name === "ri:url") {
      const url = (child as Element).attribs["ri:value"] ?? "";
      return `![${altParam}](${url})`;
    }
    if (name === "ri:attachment") {
      const filename = (child as Element).attribs["ri:filename"] ?? "";
      return `![${altParam}](./assets/${filename})`;
    }
  }

  return "";
}

// ---------------------------------------------------------------------------
// Confluence page links
// ---------------------------------------------------------------------------

function convertAcLink(el: Element): string {
  const linkBody = getChildren(el).find(
    (n): n is Element =>
      n.type === "tag" &&
      (n as Element).name.toLowerCase() === "ac:link-body"
  );
  const label = linkBody ? inline(linkBody) : "";

  const riPage = getChildren(el).find(
    (n): n is Element =>
      n.type === "tag" && (n as Element).name.toLowerCase() === "ri:page"
  );
  if (riPage) {
    const pageTitle = (riPage as Element).attribs["ri:content-title"] ?? "";
    return label ? `[${label}](${pageTitle})` : pageTitle;
  }

  return label;
}

// ---------------------------------------------------------------------------
// Entity decoder
// ---------------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&nbsp;": " ",
};

function decodeEntities(str: string): string {
  return str
    .replace(/&[a-z]+;/gi, (e) => ENTITIES[e] ?? e)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    );
}
