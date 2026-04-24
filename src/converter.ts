import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import matter from "gray-matter";
import type {
  Node,
  Parent,
  Root,
  Paragraph,
  Heading,
  Text,
  Strong,
  Emphasis,
  Delete,
  InlineCode,
  Code,
  Blockquote,
  List,
  ListItem,
  Link,
  Image,
  ThematicBreak,
  Table,
  TableRow,
  TableCell,
  Html,
  Break,
} from "mdast";

export interface ConversionResult {
  title: string;
  body: string;
  /** Any extra frontmatter fields from the markdown file */
  frontmatter: Record<string, unknown>;
}

export function convertMarkdown(
  rawMarkdown: string,
  fallbackTitle: string
): ConversionResult {
  const { data: frontmatter, content } = matter(rawMarkdown);

  const processor = unified().use(remarkParse).use(remarkGfm);
  const tree = processor.parse(content) as Root;

  const title =
    typeof frontmatter.title === "string" ? frontmatter.title : fallbackTitle;

  return {
    title,
    body: serializeNode(tree),
    frontmatter: frontmatter as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------

function serializeNode(node: Node): string {
  switch (node.type) {
    case "root":
      return serializeChildren(node as Parent);
    case "paragraph":
      return serializeParagraph(node as Paragraph);
    case "heading":
      return serializeHeading(node as Heading);
    case "text":
      return escapeXml((node as Text).value);
    case "strong":
      return `<strong>${serializeChildren(node as Parent)}</strong>`;
    case "emphasis":
      return `<em>${serializeChildren(node as Parent)}</em>`;
    case "delete":
      return `<del>${serializeChildren(node as Parent)}</del>`;
    case "inlineCode":
      return `<code>${escapeXml((node as InlineCode).value)}</code>`;
    case "code":
      return serializeCode(node as Code);
    case "blockquote":
      return `<blockquote>${serializeChildren(node as Parent)}</blockquote>`;
    case "list":
      return serializeList(node as List);
    case "listItem":
      return serializeListItem(node as ListItem);
    case "link":
      return serializeLink(node as Link);
    case "image":
      return serializeImage(node as Image);
    case "thematicBreak":
      return "<hr />";
    case "table":
      return serializeTable(node as Table);
    case "tableRow":
      return serializeTableRow(node as TableRow, false);
    case "tableCell":
      return `<td>${serializeChildren(node as Parent)}</td>`;
    case "html":
      return (node as Html).value;
    case "break":
      return "<br />";
    default:
      if ("children" in node) return serializeChildren(node as Parent);
      return "";
  }
}

function serializeChildren(node: Parent): string {
  return node.children.map(serializeNode).join("");
}

function serializeParagraph(node: Paragraph): string {
  const content = serializeChildren(node);
  // Avoid wrapping block-level macros (e.g. images that expand to ac:image) in <p>
  if (content.startsWith("<ac:image") || content.startsWith("<ac:structured-macro")) {
    return content;
  }
  return `<p>${content}</p>`;
}

function serializeHeading(node: Heading): string {
  const level = node.depth;
  const content = serializeChildren(node);
  return `<h${level}>${content}</h${level}>`;
}

function serializeCode(node: Code): string {
  const language = node.lang ?? "none";
  const title = node.meta ? `<ac:parameter ac:name="title">${escapeXml(node.meta)}</ac:parameter>` : "";
  return (
    `<ac:structured-macro ac:name="code">` +
    `<ac:parameter ac:name="language">${escapeXml(language)}</ac:parameter>` +
    title +
    `<ac:plain-text-body><![CDATA[${node.value}]]></ac:plain-text-body>` +
    `</ac:structured-macro>`
  );
}

function serializeList(node: List): string {
  const tag = node.ordered ? "ol" : "ul";
  return `<${tag}>${serializeChildren(node)}</${tag}>`;
}

function serializeListItem(node: ListItem): string {
  // Flatten single-paragraph list items to avoid <p> inside <li>
  const children = node.children;
  if (
    children.length === 1 &&
    children[0].type === "paragraph"
  ) {
    return `<li>${serializeChildren(children[0] as Parent)}</li>`;
  }
  return `<li>${serializeChildren(node)}</li>`;
}

function serializeLink(node: Link): string {
  const href = escapeXml(node.url);
  const title = node.title ? ` title="${escapeXml(node.title)}"` : "";
  return `<a href="${href}"${title}>${serializeChildren(node)}</a>`;
}

function serializeImage(node: Image): string {
  const alt = node.alt ? `<ac:parameter ac:name="alt">${escapeXml(node.alt)}</ac:parameter>` : "";
  const isExternal = node.url.startsWith("http://") || node.url.startsWith("https://");
  if (isExternal) {
    return (
      `<ac:image>${alt}<ri:url ri:value="${escapeXml(node.url)}" /></ac:image>`
    );
  }
  // Treat local paths as Confluence attachments
  const filename = node.url.split("/").pop() ?? node.url;
  return (
    `<ac:image>${alt}<ri:attachment ri:filename="${escapeXml(filename)}" /></ac:image>`
  );
}

function serializeTable(node: Table): string {
  const [headerRow, ...bodyRows] = node.children as TableRow[];
  const header = serializeTableRow(headerRow, true);
  const body = bodyRows.map((r) => serializeTableRow(r, false)).join("");
  return `<table><tbody>${header}${body}</tbody></table>`;
}

function serializeTableRow(node: TableRow, isHeader: boolean): string {
  const cells = (node.children as TableCell[])
    .map((cell) => {
      const tag = isHeader ? "th" : "td";
      return `<${tag}>${serializeChildren(cell)}</${tag}>`;
    })
    .join("");
  return `<tr>${cells}</tr>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
