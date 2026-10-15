import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiled = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const { htmlToMarkdown, truncateMarkdown } = await import(
  `${compiled.url.href}?feed-markdown=1`
);

after(() => compiled.cleanup());

test("feed code blocks preserve entity-encoded HTML source", () => {
  const markdown = htmlToMarkdown(
    "<![CDATA[<pre><code class=\"language-html\">&lt;div class=&quot;card&quot;&gt;Hello&lt;/div&gt;</code></pre>]]>",
    "https://example.com/post"
  );

  assert.match(markdown, /```html/);
  assert.match(markdown, /<div class="card">Hello<\/div>/);
});

test("markdown truncation prefers complete block boundaries", () => {
  const firstBlock = "a".repeat(150);
  const markdown = `${firstBlock}\n\n${"b".repeat(100)}`;
  const truncated = truncateMarkdown(markdown, 180);

  assert.ok(truncated.length <= 180);
  assert.equal(truncated, firstBlock);
});

test("markdown truncation closes an open fenced code block", () => {
  const markdown = `Before\n\n\`\`\`js\n${"const value = 1;\n".repeat(30)}\n\`\`\`\n\nAfter`;
  const truncated = truncateMarkdown(markdown, 180);
  const fences = truncated.match(/^```/gm) ?? [];

  assert.ok(truncated.length <= 180);
  assert.equal(fences.length, 2);
  assert.ok(truncated.endsWith("```"));
});

test("feed links and images resolve against the original article URL", () => {
  const markdown = htmlToMarkdown(
    '<p><a href="../docs/start">Read docs</a></p><img src="../images/cover.png" alt="Cover">',
    "https://example.com/posts/entry/"
  );

  assert.match(markdown, /\[Read docs\]\(https:\/\/example\.com\/posts\/docs\/start\)/);
  assert.match(markdown, /!\[Cover\]\(https:\/\/example\.com\/posts\/images\/cover\.png\)/);
});

test("unsafe feed link and image protocols are removed", () => {
  const markdown = htmlToMarkdown(
    '<p><a href="javascript:alert(1)">Open</a></p><img src="data:image/svg+xml,bad" alt="Bad">',
    "https://example.com/post"
  );

  assert.equal(markdown, "Open");
});

test("four-backtick fences stay balanced when content contains three backticks", () => {
  const markdown = `${"a".repeat(140)}\n\n\`\`\`\`markdown\nbefore\n\`\`\`\nafter ${"x".repeat(100)}\n\`\`\`\``;
  const truncated = truncateMarkdown(markdown, 210);

  assert.ok(truncated.length <= 210);
  assert.ok(truncated.endsWith("````"));
});

test("feed headings, emphasis, deletion and captions keep their markdown meaning", () => {
  const markdown = htmlToMarkdown(
    '<h4>Details</h4><p><em>Important</em> and <del>obsolete</del></p><figure><img src="cover.png" alt="Cover"><figcaption>Image caption</figcaption></figure>',
    "https://example.com/posts/"
  );

  assert.match(markdown, /#### Details/);
  assert.match(markdown, /_Important_ and ~~obsolete~~/);
  assert.match(markdown, /!\[Cover\]\(https:\/\/example\.com\/posts\/cover\.png\)/);
  assert.match(markdown, /\*Image caption\*/);
});

test("ordered and nested feed lists preserve numbering and indentation", () => {
  const markdown = htmlToMarkdown(
    '<ol><li>First</li><li>Second<ul><li>Nested A</li><li>Nested B</li></ul></li></ol>',
    "https://example.com/post"
  );

  assert.match(markdown, /^1\. First$/m);
  assert.match(markdown, /^2\. Second$/m);
  assert.match(markdown, /^   - Nested A$/m);
  assert.match(markdown, /^   - Nested B$/m);
});

test("html-looking source inside code blocks is not converted as article formatting", () => {
  const markdown = htmlToMarkdown(
    '<pre><code>&lt;ol&gt;&lt;li&gt;Code item&lt;/li&gt;&lt;/ol&gt;\n&lt;h4&gt;Code heading&lt;/h4&gt;</code></pre>',
    "https://example.com/post"
  );

  assert.match(markdown, /<ol><li>Code item<\/li><\/ol>/);
  assert.match(markdown, /<h4>Code heading<\/h4>/);
  assert.doesNotMatch(markdown, /^1\. Code item$/m);
  assert.doesNotMatch(markdown, /^#### Code heading$/m);
});
