// Проверка баланса HTML-тегов на всех страницах сайта.
import { readFileSync, readdirSync } from "node:fs";

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "source", "track", "wbr", "path", "circle", "rect", "line",
  "polyline", "polygon", "ellipse", "stop", "use",
]);

const files = readdirSync(".").filter((f) => f.endsWith(".html")).sort();
let failures = 0;

for (const file of files) {
  const text = readFileSync(file, "utf8");
  const stack = [];
  const errors = [];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const closing = m[1];
    const tag = m[2].toLowerCase();
    const attrs = m[3];
    const selfClose = m[4];
    if (tag === "!doctype") continue;
    if (VOID.has(tag) || selfClose === "/") continue;
    const line = text.slice(0, m.index).split("\n").length;
    if (closing) {
      if (stack.length && stack[stack.length - 1].tag === tag) stack.pop();
      else errors.push(`неожиданный </${tag}> на строке ${line}`);
    } else {
      stack.push({ tag, line });
    }
  }
  const unclosed = stack.map((s) => `<${s.tag}> строка ${s.line}`);
  if (errors.length || unclosed.length) {
    failures += 1;
    console.log(`${file} — ОШИБКИ`);
    if (unclosed.length) console.log("  не закрыты:", unclosed.join(", "));
    if (errors.length) console.log("  ", errors.slice(0, 5).join("; "));
  } else {
    console.log(`${file} — ok`);
  }
}

console.log(failures ? `\nПроблемных файлов: ${failures}` : "\nВсе страницы сбалансированы");
process.exit(failures ? 1 : 0);
