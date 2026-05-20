// CommonMark does not allow colons in tag names, so <ac:...> and <ri:...> tags
// are treated as literal text by remark-parse and get XML-escaped. This module
// extracts those tags before parsing and restores them after serialisation.

// Two separate patterns: self-closing must be tried first so the `/` in `/>` is
// not consumed by the attribute group.
const NS_SELF_CLOSE_RE = /^<((?:ac|ri|at):[a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*?)?\/>/s;
const NS_OPEN_TAG_RE   = /^<((?:ac|ri|at):[a-zA-Z][a-zA-Z0-9-]*)(\s[^>]*)?>/s;

export function preprocessXmlMacros(content: string): {
  processed: string;
  restore: (serialized: string) => string;
} {
  const replacements = new Map<string, string>();
  let counter = 0;
  let output = "";
  let i = 0;

  while (i < content.length) {
    // Skip fenced code blocks so macros inside them are never touched
    if (
      (content[i] === "`" || content[i] === "~") &&
      content[i + 1] === content[i] &&
      content[i + 2] === content[i]
    ) {
      const fence = content[i].repeat(3);
      const closeIndex = content.indexOf("\n" + fence, i + fence.length);
      if (closeIndex !== -1) {
        const end = closeIndex + fence.length + 1;
        output += content.slice(i, end);
        i = end;
        continue;
      }
    }

    if (content[i] === "<") {
      const slice = content.slice(i);
      const selfMatch = slice.match(NS_SELF_CLOSE_RE);
      const openMatch = selfMatch ? null : slice.match(NS_OPEN_TAG_RE);
      const match = selfMatch ?? openMatch;
      if (match) {
        const tagName = match[1];
        let consumed: number;

        if (selfMatch) {
          consumed = match[0].length;
        } else {
          consumed = extractPairedXml(content, i, tagName);
        }

        const key = `<!--XMLMACRO${counter++}-->`;
        replacements.set(key, content.slice(i, i + consumed));
        output += key;
        i += consumed;
        continue;
      }
    }

    output += content[i];
    i++;
  }

  return {
    processed: output,
    restore: (s: string) => {
      let result = s;
      for (const [key, value] of replacements) {
        // split/join avoids issues with special regex characters in `value`
        result = result.split(key).join(value);
      }
      return result;
    },
  };
}

function extractPairedXml(
  content: string,
  start: number,
  tagName: string
): number {
  const openTagEnd = content.indexOf(">", start);
  if (openTagEnd === -1) return content.length - start;

  let i = openTagEnd + 1;
  let depth = 1;
  const esc = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const openRe = new RegExp(`^<${esc}(\\s[^>]*)?>`, "s");
  const selfCloseRe = new RegExp(`^<${esc}(\\s[^>]*)?/>`, "s");
  const closeRe = new RegExp(`^<\\/${esc}\\s*>`);

  while (i < content.length && depth > 0) {
    if (content[i] !== "<") {
      i++;
      continue;
    }
    const rest = content.slice(i);
    const sc = rest.match(selfCloseRe);
    if (sc) { i += sc[0].length; continue; }
    const op = rest.match(openRe);
    if (op) { depth++; i += op[0].length; continue; }
    const cl = rest.match(closeRe);
    if (cl) { depth--; i += cl[0].length; continue; }
    i++;
  }

  return i - start;
}
