import { readFile } from "node:fs/promises";

// Node has no built-in handler for `import … with { type: "text" }` on
// non-JS extensions. Bun does. This loader is the repo's single mechanism for
// the text-import sites under Node smokes (.md prompts, .lark grammars).
export async function load(url, context, nextLoad) {
  if (!url.endsWith(".md") && !url.endsWith(".lark")) return nextLoad(url, context);
  const content = await readFile(new URL(url), "utf8");
  return {
    format: "module",
    shortCircuit: true,
    source: `export default ${JSON.stringify(content)};`,
  };
}
