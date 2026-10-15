import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const proxy = await compileTypescriptModule(new URL("../../src/proxy.ts", import.meta.url));
after(() => proxy.cleanup());
const source = await readFile(new URL("../../src/components/MarkdownContent.tsx", import.meta.url), "utf8");
let compiled = ts.transpileModule(source, {
  fileName: "MarkdownContent.tsx",
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
for (const specifier of ["react", "react/jsx-runtime", "lucide-react", "react-markdown", "rehype-raw", "rehype-sanitize", "remark-breaks", "remark-gfm", "remark-parse", "unified"]) {
  compiled = compiled.replaceAll(`from "${specifier}"`, `from "${import.meta.resolve(specifier)}"`);
}
compiled = compiled.replaceAll('from "../proxy"', `from "${proxy.url.href}"`);
const { default: MarkdownContent } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const render = (content) => renderToStaticMarkup(createElement(MarkdownContent, { content, locale: "zh" }));

for (const fence of ["```", "~~~~"]) {
  test(`${fence} 围栏代码保留 script 与 style 原文并转义显示`, () => {
    const html = render(`${fence}html\n<script src="https://example.com/app.js"></script>\n<style>.demo { color: red; }</style>\n${fence}`);
    assert.ok(html.includes("https://example.com/app.js"));
    assert.ok(html.includes(".demo { color: red; }"));
    assert.ok(html.includes("&lt;script"));
    assert.ok(html.includes("&lt;style&gt;"));
    assert.doesNotMatch(html, /<script\b|<style\b|>undefined</i);
  });
}

test("行内和缩进代码中的 HTML 示例保留原文", () => {
  for (const content of [
    '`<script>window.example = 1;</script>`',
    '代码示例：\n\n    <script>window.example = 1;</script>',
    '`<style>.example { display: block; }</style>`'
  ]) {
    const html = render(content);
    assert.ok(html.includes("example"));
    assert.doesNotMatch(html, /<script\b|<style\b/i);
  }
});

test("正文中的危险 HTML 仍被清除，普通格式和链接继续保留", () => {
  const html = render([
    '<script>window.unsafeScript = true;</script>',
    '<style>.unsafeStyle { display: none; }</style>',
    '<p onclick="alert(1)">普通正文 <strong>强调</strong></p>',
    '<img src="https://example.com/image.png" onerror="alert(1)">',
    '<a href="javascript:alert(1)">危险链接</a>',
    '[安全链接](https://example.com/safe)'
  ].join("\n\n"));
  assert.doesNotMatch(html, /<script\b|<style\b|unsafeScript|unsafeStyle|onclick|onerror|javascript:/i);
  assert.ok(html.includes("普通正文"));
  assert.ok(html.includes("<strong>强调</strong>"));
  assert.ok(html.includes('href="https://example.com/safe"'));
});

for (const [name, wrap] of [
  ["反引号围栏", (code) => `\`\`\`text\n${code}\n\`\`\``],
  ["波浪线围栏", (code) => `~~~~text\n${code}\n~~~~`],
  ["嵌套反引号围栏", (code) => `\`\`\`\`markdown\n\`\`\`text\n${code}\n\`\`\`\n\`\`\`\``],
  ["未闭合围栏", (code) => `\`\`\`text\n${code}`],
  ["缩进代码", (code) => code.split("\n").map((line) => `    ${line}`).join("\n")],
  ["制表符缩进代码", (code) => code.split("\n").map((line) => `\t${line}`).join("\n")],
  ["引用中的围栏", (code) => `\`\`\`text\n${code}\n\`\`\``.split("\n").map((line) => `> ${line}`).join("\n")],
  ["列表中的围栏", (code) => `- 示例\n\n${`\`\`\`text\n${code}\n\`\`\``.split("\n").map((line) => `  ${line}`).join("\n")}`],
  ["引用与列表嵌套围栏", (code) => `> - 示例\n>\n${`\`\`\`text\n${code}\n\`\`\``.split("\n").map((line) => `>   ${line}`).join("\n")}`]
]) {
  test(`${name}完整保留指令、注释、锚点和链接卡片语法`, () => {
    const code = [
      "#if DEBUG",
      "#endif",
      "#comment",
      '<a class="headerlink" href="#demo"></a>',
      "[](#demo)",
      "[Tag](/search/result?word=demo)",
      "×",
      "::links",
      "# Demo",
      "- [Example](https://example.com)",
      "::"
    ].join("\n");
    const html = render(wrap(code));
    for (const fragment of ["#if DEBUG", "#endif", "#comment", "&lt;a class=&quot;headerlink&quot;", "[](#demo)", "[Tag](/search/result?word=demo)", "×", "::links"]) {
      assert.ok(html.includes(fragment), `缺少 ${fragment}`);
    }
    assert.doesNotMatch(html, /product-links-section|<a\b/);
  });
}

test("行内代码保留锚点、链接与多反引号内容，正文继续清理", () => {
  const html = render([
    '# 标题<a class="headerlink" href="#title"></a>',
    '语法 `[](#demo)` 与 ``[Tag](/search/result?word=demo) `x` ``。',
    'HTML：`<a class="headerlink" href="#demo"></a>`',
    "[](#remove)",
    "#tag #topic",
    "×",
    "[正文标签](/search/result?word=demo)"
  ].join("\n\n"));
  assert.ok(html.includes("[](#demo)"));
  assert.ok(html.includes("[Tag](/search/result?word=demo) `x`"));
  assert.ok(html.includes("&lt;a class=&quot;headerlink&quot;"));
  assert.ok(html.includes("正文标签"));
  assert.doesNotMatch(html, /#remove|#tag|#topic|×|<a\b/);
});

test("GFM 表格按单元格定位行内代码，不受其他单元格未配对反引号影响", () => {
  const html = render([
    "| `未配对 | 示例 |",
    "| --- | --- |",
    "| 标识符 | `[](#anchor)` |",
    "| 注释 | `#comment` |"
  ].join("\n"));
  assert.ok(html.includes("<table>"));
  assert.ok(html.includes("<code>[](#anchor)</code>"));
  assert.ok(html.includes("<code>#comment</code>"));
});

test("正文中的链接卡片与原文卡片继续提取，代码中的原文标题不提取", () => {
  const html = render([
    "```md",
    "## Original Link",
    "[Example](https://example.com/code)",
    "```",
    "",
    "::links",
    "# 项目 `名称`",
    "- [说明 `code`](https://example.com/docs)",
    "::",
    "",
    "## 原文链接",
    "[原文 `code`](https://example.com/article)"
  ].join("\n"));
  assert.equal((html.match(/product-links-section/g) ?? []).length, 2);
  assert.ok(html.includes("## Original Link"));
  assert.ok(html.includes("[Example](https://example.com/code)"));
  assert.ok(html.includes("项目 `名称`"));
  assert.ok(html.includes("说明 `code`"));
  assert.ok(html.includes("原文 `code`"));
  assert.doesNotMatch(html, /\uE000/);
});

test("旧版编号代码仍被修复，已有代码内的编号不被再次转换", () => {
  const numbered = `${Array.from({ length: 10 }, (_, index) => index + 1).join("\n")}\nconst demo = 1;`;
  const repaired = render(`示例\n${numbered}`);
  assert.ok(repaired.includes('class="markdown-code-block"'));
  assert.ok(repaired.includes("const demo = 1;"));
  const existingCode = render(`\`\`\`text\n${numbered}\n\`\`\``);
  assert.equal((existingCode.match(/class="markdown-code-line-content"/g) ?? []).length, 11);
  assert.doesNotMatch(existingCode, /```/);
});

test("旧版编号代码修复保留多行模板字符串及其内部缩进", () => {
  const lines = [
    ...Array.from({ length: 10 }, (_, index) => String(index + 1)),
    "function demo() {",
    "const text = `hello",
    "  world`;",
    "const next = `next",
    "value`;",
    "}"
  ];
  for (const newline of ["\n", "\r\n"]) {
    const html = render(lines.join(newline));
    const renderedLines = [...html.matchAll(/<span class="markdown-code-line-content">([\s\S]*?)<\/span>/g)]
      .map((match) => match[1]);
    assert.deepEqual(renderedLines, [
      "function demo() {",
      "  const text = `hello",
      "  world`;",
      "  const next = `next",
      "value`;",
      "}"
    ]);
    assert.doesNotMatch(html, /\uE000|\uE001/);
  }
});

test("保护标记与输入中已有私人字符互不冲突", () => {
  const html = render("已有字符 \uE0000\uE000，与 `[](#demo)` 共存。");
  assert.ok(html.includes("\uE0000\uE000"));
  assert.ok(html.includes("<code>[](#demo)</code>"));
});

test("不完整的锚点或链接清理不吞掉其中的行内代码", () => {
  for (const content of [
    '正文 <a class="headerlink" `[](#demo)`',
    '正文 <a class=`headerlink` href="#anchor"></a>',
    '正文 [](# `code`)',
    '正文 [label](/search/result `code`)'
  ]) {
    const html = render(content);
    assert.match(html, /<code>(?:\[\]\(#demo\)|headerlink|code)<\/code>/);
  }
});

test("代码保护不会把多行示例或无效链接目标误变成链接卡片", () => {
  for (const content of [
    "::links\n# Demo\n- [label `code\n#comment`](https://example.com)\n::",
    "::links\n# Demo\n- [label](`code with spaces`)\n::",
    "## Original Link\n[label](`code with spaces`)"
  ]) {
    const html = render(content);
    assert.ok(html.includes("<code>"));
    assert.doesNotMatch(html, /product-links-section|\uE000|\uE001/);
  }
});
