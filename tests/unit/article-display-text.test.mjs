import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const stub = (body) => `data:text/javascript,${encodeURIComponent(body)}`;
const i18nStub = stub(
  `export const translations = { zh: { __locale: "zh" }, en: { __locale: "en" } };`
);
const compiledArticleHelpers = await compileTypescriptModule(
  new URL("../../src/article-helpers.ts", import.meta.url),
  {
    importReplacements: {
      "lucide-react": stub(
        `export const BadgeCheck=1,BarChart3=1,Boxes=1,BrainCircuit=1,Code2=1,` +
          `Database=1,FileImage=1,FileText=1,Globe2=1,LayoutDashboard=1,Link2=1,` +
          `Mail=1,PackagePlus=1,Server=1,Sparkles=1,Star=1,Tags=1;`
      ),
      "./admin-field-examples": stub(
        `export const ADMIN_RESOURCE_FIELD_EXAMPLES = { zh: {}, en: {} };`
      ),
      "./i18n": i18nStub,
      "./admin-helpers": stub(`export const ADMIN_FEATURED_CATEGORY = "Featured";`)
    }
  }
);
const articleHelpers = await import(
  `${compiledArticleHelpers.url.href}?article-text=1`
);
const { translations } = await import(i18nStub);
const clean = articleHelpers.cleanArticleDisplayText;

after(async () => {
  await compiledArticleHelpers.cleanup();
});

test("display text decodes the HTML entities feeds actually emit", () => {
  assert.equal(clean("a&nbsp;b"), "a b");
  assert.equal(clean("a&amp;b"), "a&b");
  assert.equal(clean("&quot;q&quot;"), '"q"');
  assert.equal(clean("it&#39;s"), "it's");
  assert.equal(clean("&#65;&#66;"), "AB");
  assert.equal(clean("&#x41;&#x42;"), "AB");
  assert.equal(clean("&AMP;"), "&");
});

test("out-of-range numeric entities are dropped instead of throwing", () => {
  assert.equal(clean("&#999999999;"), "");
  assert.equal(clean("&#x110000;"), "");
  assert.equal(clean("&nbsp"), "&nbsp");
  assert.equal(clean("&#;"), "&#;");
});

test("decoded entities are re-processed as markup, so &lt;div&gt; disappears", () => {
  assert.equal(clean("&lt;div&gt;"), "");
  assert.equal(clean("&lt;p&gt;文本&lt;/p&gt;"), "文本");
});

test("script and style blocks are removed with their contents", () => {
  assert.equal(clean("<script>alert(1)</script>a"), "a");
  assert.equal(clean("<SCRIPT>alert(1)</SCRIPT>a"), "a");
  assert.equal(clean("<style>.x{}</style>b"), "b");
  assert.equal(clean("<script>a</script>mid<script>b</script>end"), "mid end");
  assert.equal(clean("<script>x"), "x");
});

test("heading anchor links are removed in both closed and truncated forms", () => {
  assert.equal(clean('<a class="headerlink" href="#h"></a>标题'), "标题");
  assert.equal(clean('<a href="#top"></a>标题'), "标题");
  assert.equal(clean('标题<a class="headerlink" href="#h"'), "标题");
  assert.equal(clean("[](#anchor)标题"), "标题");
  assert.equal(
    clean('<h2 id="t">标题<a class="headerlink" href="#t" title="标题"></a></h2>'),
    "标题"
  );
});

test("markdown links and images collapse to their visible text", () => {
  assert.equal(clean("![alt](img.png)"), "alt");
  assert.equal(clean("![](img.png)"), "");
  assert.equal(clean("![a](u(1).png)"), "a");
  assert.equal(clean("[text](http://x.com)"), "text");
  assert.equal(clean("[text](http://x.com/a(1))"), "text");
  assert.equal(clean("[![alt](i.png)](http://x.com)"), "alt");
  assert.equal(clean("`code`"), "code");
  assert.equal(clean("`a` 和 `b`"), "a 和 b");
  assert.equal(clean("`abc"), "`abc");
});

test("leading headings are stripped but mid-text hashes survive", () => {
  assert.equal(clean("## 标题"), "标题");
  assert.equal(clean("###### 六级"), "六级");
  assert.equal(clean("正文 ## 中间"), "正文 ## 中间");
});

test("emphasis marks are removed everywhere, including inside identifiers", () => {
  assert.equal(clean("**粗体**"), "粗体");
  assert.equal(clean("_斜体_"), "斜体");
  assert.equal(clean("~~删除~~"), "删除");
  assert.equal(clean("<b>*粗*</b>"), "粗");
  assert.equal(clean("snake_case_name"), "snakecasename");
  assert.equal(clean("MAX_SAFE_INTEGER"), "MAXSAFEINTEGER");
  assert.equal(clean("__dirname"), "dirname");
  assert.equal(clean("2 * 3 = 6"), "2 3 = 6");
});

test("remaining tags become spaces and decorative crosses are dropped", () => {
  assert.equal(clean("<div><p>文本</p></div>"), "文本");
  assert.equal(clean("<p>段落一</p>\n<p>段落二</p>"), "段落一 段落二");
  assert.equal(clean("a<br>b"), "a b");
  assert.equal(clean("<!-- c -->文本"), "文本");
  assert.equal(clean("文本 × 后"), "文本 后");
  assert.equal(clean("✕ 文本"), "文本");
  assert.equal(clean("文本 ✖"), "文本");
});

test("attribute values containing a bare > leak, so callers must pre-sanitize", () => {
  assert.equal(clean('<a title="a>b">x</a>'), 'b">x');
  assert.equal(clean('<div data-x="1>2">正文</div>'), '2">正文');
  assert.equal(clean('<a href="http://x.com" title="标题">文本</a>'), "文本");
});

test("fenced code blocks are not markup, so their fences partly remain", () => {
  assert.equal(clean("```js\ncode\n```"), "``js code ``");
  assert.equal(clean("````code````"), "```code```");
  assert.equal(clean("~~~\ncode\n~~~"), "code");
});

test("trailing channel hashtags are removed only when two or more appear", () => {
  assert.equal(clean("正文 #标签A #标签B"), "正文");
  assert.equal(clean("正文 #A #B #C"), "正文");
  assert.equal(clean("正文 #a_b #c_d"), "正文");
  assert.equal(clean("正文 #a-b #c-d"), "正文");
  assert.equal(clean("正文 #A#B"), "正文");
  assert.equal(clean("正文 #A #B 频道 | 聊天"), "正文");
  assert.equal(clean("正文 #A #B 频道｜聊天"), "正文");
  assert.equal(
    clean("内容内容\n\n#Cloudflare #Worker\n频道 | 聊天"),
    "内容内容"
  );
});

test("a single trailing hashtag, mid-text hashtags, and trailing punctuation stay", () => {
  assert.equal(clean("正文 #标签A"), "正文 #标签A");
  assert.equal(clean("#A #B 正文在后"), "#A #B 正文在后");
  assert.equal(clean("正文 #A #B。"), "正文 #A #B。");
  assert.equal(clean("#A #B"), "#A #B");
});

test("whitespace of every kind collapses to single spaces and trims", () => {
  assert.equal(clean("a    b"), "a b");
  assert.equal(clean("a\nb"), "a b");
  assert.equal(clean("a\tb"), "a b");
  assert.equal(clean("   a   "), "a");
  assert.equal(clean(""), "");
  assert.equal(clean("   "), "");
});

test("real feed payloads reduce to plain summary text", () => {
  assert.equal(
    clean("![](https://a.com/1.png)\n这是摘要正文。"),
    "这是摘要正文。"
  );
  assert.equal(
    clean("<p>介绍 <a href=\"http://x.com\">链接</a> 结尾</p>"),
    "介绍 链接 结尾"
  );
});

test("display titles prefer the title, then the summary, then a fallback", () => {
  const title = articleHelpers.getArticleDisplayTitle;

  assert.equal(title({ title: "我的标题", summary: "摘要", content: "正文" }), "我的标题");
  assert.equal(title({ title: "", summary: "摘要文本", content: "" }), "摘要文本");
  assert.equal(title({ title: "", summary: "", content: "" }), "Untitled");
  assert.equal(title({ title: "## 带井号", summary: "", content: "" }), "带井号");
});

test("an empty title is derived from the first meaningful content line", () => {
  const title = articleHelpers.getArticleDisplayTitle;

  assert.equal(
    title({ title: "", summary: "", content: "# 从正文提取\n后续" }),
    "从正文提取"
  );
  assert.equal(
    title({ title: "", summary: "", content: "**粗体标题**\n后续" }),
    "粗体标题"
  );
  assert.equal(
    title({ title: "", summary: "", content: "×\n真正标题" }),
    "真正标题"
  );
  assert.equal(
    title({ title: "", summary: "", content: "![](a.png)\n真正标题" }),
    "真正标题"
  );
  assert.equal(
    title({ title: "", summary: "", content: "[![](a.png)](http://x)\n真正标题" }),
    "真正标题"
  );
});

test("derived titles split on known field labels so metadata is not part of the title", () => {
  assert.equal(
    articleHelpers.getArticleDisplayTitle({
      title: "",
      summary: "",
      content: "节点名称 流量：100G"
    }),
    "节点名称"
  );
});

test("over-long titles are truncated with an ellipsis at 140 characters", () => {
  const derived = articleHelpers.getArticleDisplayTitle({
    title: "字".repeat(200),
    summary: "",
    content: ""
  });

  assert.equal(derived.length, 143);
  assert.ok(derived.endsWith("..."));
  assert.equal(derived.slice(0, 140), "字".repeat(140));
});

test("markdown image URLs shed their wrapping brackets and quotes", () => {
  const normalize = articleHelpers.normalizeMarkdownImageUrl;

  assert.equal(normalize("  a.png  "), "a.png");
  assert.equal(normalize("<a.png>"), "a.png");
  assert.equal(normalize("'a.png'"), "a.png");
  assert.equal(normalize('"a.png"'), "a.png");
  assert.equal(normalize("<'a.png'>"), "a.png");
  assert.equal(normalize("<>"), "");
  assert.equal(normalize(""), "");
});

test("leading duplicates of the title, cover, and summary are stripped from content", () => {
  const strip = articleHelpers.stripLeadingArticleDuplicates;

  assert.equal(strip("# 标题\n正文", "标题", ""), "正文");
  assert.equal(strip("![](c.png)\n\n正文", "T", "", "c.png"), "正文");
  assert.equal(strip("![](<c.png>)\n\n正文", "T", "", "c.png"), "正文");
  assert.equal(strip("×\n\n# 标题\n\n正文", "标题", ""), "正文");
  assert.equal(strip("正文开始", "标题", "摘要"), "正文开始");
});

test("a duplicated summary paragraph is stripped only when a blank line ends it", () => {
  const strip = articleHelpers.stripLeadingArticleDuplicates;

  assert.equal(strip("摘要文本内容够长\n\n正文", "标题", "摘要文本内容够长"), "正文");
  assert.equal(
    strip("摘要文本内容够长\n正文", "标题", "摘要文本内容够长"),
    "摘要文本内容够长\n正文"
  );
});

test("a duplicated blockquote is stripped, an unrelated one is kept", () => {
  const strip = articleHelpers.stripLeadingArticleDuplicates;

  assert.equal(strip("> 摘要文本内容够长\n\n正文", "标题", "摘要文本内容够长"), "正文");
  assert.equal(strip("> 标题文本内容够长\n\n正文", "标题文本内容够长", ""), "正文");
  assert.equal(strip("> 别的话\n\n正文", "标题", "摘要"), "> 别的话\n\n正文");
});

test("non-cover leading images are preserved and split across lines are rejoined", () => {
  const strip = articleHelpers.stripLeadingArticleDuplicates;

  assert.equal(strip("![](x.png)\n\n正文", "T", "", "c.png"), "![](x.png)\n\n正文");
  assert.equal(strip("![](x.png)\n\n正文", "T", ""), "![](x.png)\n\n正文");
  assert.equal(
    strip("[\n![](a.png)\n](http://x)\n\n正文", "T", ""),
    "[![](a.png)](http://x)\n\n正文"
  );
});

test("Chinese locale detection compares object identity, not content", () => {
  assert.equal(articleHelpers.isChineseLocaleText(translations.zh), true);
  assert.equal(articleHelpers.isChineseLocaleText(translations.en), false);
  assert.equal(articleHelpers.isChineseLocaleText({ __locale: "zh" }), false);
});
