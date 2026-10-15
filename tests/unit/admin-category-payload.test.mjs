import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

// admin-helpers.ts 只有类型导入,可以直接编译执行
const compiledHelpers = await compileTypescriptModule(
  new URL("../../src/admin-helpers.ts", import.meta.url)
);
const helpers = await import(`${compiledHelpers.url.href}?category-payload=1`);

// admin-text.ts 有两个值导入,用 data URL 桩替掉后就能真实执行文案函数
const helpersStub = `data:text/javascript,${encodeURIComponent(`
  export const DEFAULT_SOURCE_URL = "https://example.com/htools.json";
`)}`;
const fieldExamplesStub = `data:text/javascript,${encodeURIComponent(`
  const fields = {
    name: "", description: "", adminName: "", adminDescription: "",
    url: "", demoUrl: "", tags: "", adminTags: "", image: ""
  };
  export const ADMIN_RESOURCE_FIELD_EXAMPLES = { zh: fields, en: fields };
`)}`;
const compiledText = await compileTypescriptModule(
  new URL("../../src/admin-text.ts", import.meta.url),
  {
    importReplacements: {
      "./admin-helpers": helpersStub,
      "./admin-field-examples": fieldExamplesStub
    }
  }
);
const adminText = await import(`${compiledText.url.href}?category-payload=1`);

const adminSource = await readFile(
  new URL("../../src/AdminApp.tsx", import.meta.url),
  "utf8"
);

after(async () => {
  await Promise.all([compiledHelpers.cleanup(), compiledText.cleanup()]);
});

const zhCategory = adminText.getAdminWorkspaceText("zh").category;
const enCategory = adminText.getAdminWorkspaceText("en").category;

test("订阅分类给人看的数字只数内容条数，不把订阅源加进去", () => {
  const categoryCounts = { 博客: 30, 资讯: 30, Epic: 2 };

  assert.equal(helpers.countContentCategoryItems(categoryCounts, "博客"), 30);
  assert.equal(helpers.countContentCategoryItems(categoryCounts, "All"), 62);
  assert.equal(helpers.countContentCategoryItems(categoryCounts, "全部"), 62);
  assert.equal(helpers.countContentCategoryItems({}, "博客"), 0);

  // 订阅源单独数,两者永远不相加 —— 相加就会把 30 条内容说成 31 条
  const sources = [
    { category: "博客" },
    { category: "博客" },
    { category: "Epic" }
  ];
  assert.equal(helpers.countContentCategorySources(sources, "博客"), 2);
  assert.equal(helpers.countContentCategorySources(sources, "All"), 3);
  assert.equal(helpers.countContentCategorySources([], "博客"), 0);
});

test("删除守卫：零内容但有订阅时必须仍然弹确认", () => {
  // 这条是防"无确认删掉订阅源"复发的闸门,只测数字测不出来
  assert.equal(helpers.hasDeletableContentCategoryPayload(0, 1), true);
  assert.equal(helpers.hasDeletableContentCategoryPayload(30, 0), true);
  assert.equal(helpers.hasDeletableContentCategoryPayload(30, 1), true);
  assert.equal(helpers.hasDeletableContentCategoryPayload(0, 0), false);
});

test("后台删分类走的是守卫，而不是直接看给人看的那个数字", () => {
  const deleteSource = adminSource.slice(
    adminSource.indexOf("async function deleteAdminCategory("),
    adminSource.indexOf("function getAdminCategoryContentCount(")
  );
  assert.notEqual(deleteSource.length, 0);

  // 订阅内容必须过守卫,其他三个栏目仍按内容条数判断
  assert.match(deleteSource, /hasDeletableContentCategoryPayload\(contentCount, sourceCount\)/);
  assert.match(deleteSource, /if \(hasDeletablePayload\) \{/);
  // 弹窗要两个数,必须在打开弹窗时就存进 state
  assert.match(deleteSource, /sourceCount: getAdminCategorySourceCount\(scope, normalized\)/);
  assert.match(deleteSource, /contentCount,\s*sourceCount,\s*scope/);

  const countSource = adminSource.slice(
    adminSource.indexOf("function getAdminCategoryContentCount("),
    adminSource.indexOf("function getCategoryActionOptions(")
  );
  assert.match(countSource, /countContentCategoryItems\(contentCategoryCounts, normalized\)/);
  // 旧写法"订阅源 + 内容"不许回来
  assert.doesNotMatch(countSource, /sourceCount \+ itemCount/);
  assert.doesNotMatch(countSource, /contentSources\.length \+/);
});

test("订阅内容的两个弹窗都同时说清订阅和内容两个数", () => {
  assert.equal(
    zhCategory.contentClearDescription(4, 89),
    "这将清空订阅内容中的 4 个订阅和 89 条内容。"
  );
  assert.equal(
    zhCategory.contentOccupiedDescription(1, 30),
    "这个分类下还有 1 个订阅和 30 条内容。可以迁移到其他分类，也可以删除分类及内容。"
  );
  assert.equal(
    enCategory.contentClearDescription(4, 89),
    "This will delete 4 subscriptions and 89 subscription items from Subscription Content."
  );
  // 英文单复数
  assert.equal(
    enCategory.contentClearDescription(1, 1),
    "This will delete 1 subscription and 1 subscription item from Subscription Content."
  );
});

test("数量为 0 的那一段整段省掉，弹窗里不会出现 0", () => {
  const zhOnlySources = zhCategory.contentClearDescription(4, 0);
  assert.equal(zhOnlySources, "这将清空订阅内容中的 4 个订阅。");
  assert.doesNotMatch(zhOnlySources, /0/);

  const zhOnlyItems = zhCategory.contentOccupiedDescription(0, 30);
  assert.match(zhOnlyItems, /^这个分类下还有 30 条内容。/);
  assert.doesNotMatch(zhOnlyItems, /0 个/);

  const enOnlyItems = enCategory.contentClearDescription(0, 89);
  assert.equal(
    enOnlyItems,
    "This will delete 89 subscription items from Subscription Content."
  );
  assert.doesNotMatch(enOnlyItems, /0 subscription/);
});

test("工具库、文章管理和消息推送共用的那两句文案逐字未变", () => {
  // 四个栏目共用 clearDescription / occupiedDescription,这是本轮最该防的回归
  assert.equal(
    zhCategory.clearDescription("工具库", 5),
    "这将清空工具库中的 5 条内容。"
  );
  assert.equal(
    zhCategory.occupiedDescription(5),
    "这个分类下还有 5 条内容。可以迁移到其他分类，也可以删除分类及内容。"
  );
  assert.equal(
    enCategory.clearDescription("Articles", 5),
    "This will clear 5 items from Articles."
  );
  assert.equal(
    enCategory.occupiedDescription(5),
    "This category still has 5 items. You can migrate them to another category or delete the category and its content."
  );
  assert.equal(
    zhCategory.pushCategoryDescription,
    "可将此分类下的推送记录迁移到其他分类，或删除分类及其全部记录。"
  );
});

test("空工作区点“全部”的垃圾桶时，回退到不带数字的那句，不拼出缺一块的句子", () => {
  // 具名分类有守卫拦着,但"全部"这一支是无条件弹窗的:
  // 线上测试站被清空后就是 0 订阅 0 内容,当时会拼出"这将清空订阅内容中的 。"
  const empty = adminText.getContentCategoryActionDescription(zhCategory, {
    isAll: true,
    sourceCount: 0,
    itemCount: 0
  });
  assert.equal(empty, "这将清空订阅内容中的全部内容。");
  assert.doesNotMatch(empty, /中的 。|中的。/);

  const emptyEn = adminText.getContentCategoryActionDescription(enCategory, {
    isAll: true,
    sourceCount: 0,
    itemCount: 0
  });
  assert.equal(emptyEn, "This will clear all content from Subscription Content.");

  // 非空时仍然说两个数
  assert.equal(
    adminText.getContentCategoryActionDescription(zhCategory, {
      isAll: true,
      sourceCount: 4,
      itemCount: 89
    }),
    "这将清空订阅内容中的 4 个订阅和 89 条内容。"
  );
  // 具名分类走另一句,并且不受"两个都是 0"那条回退影响
  assert.equal(
    adminText.getContentCategoryActionDescription(zhCategory, {
      isAll: false,
      sourceCount: 1,
      itemCount: 30
    }),
    "这个分类下还有 1 个订阅和 30 条内容。可以迁移到其他分类，也可以删除分类及内容。"
  );

  // 页面必须走这个函数,不能自己再拼一遍
  assert.match(adminSource, /getContentCategoryActionDescription\(categoryText, \{/);
});

test("订阅源结果不按内容列表的轮次丢弃，只看它自己那条轮次", () => {
  // 2026-08-16 实测复现:先选中一个订阅源再清空全部内容,清空后筛选被切回"全部",
  // 这个状态变化触发第二次刷新(不重读订阅源),第一次读回的订阅源列表被内容轮次作废
  // → 左栏永久留着已删除的订阅源,而且提示还是"已清空全部内容"。
  const refreshSource = adminSource.slice(
    adminSource.indexOf("async function refreshContent("),
    adminSource.indexOf("async function loadMoreContentItems(")
  );
  assert.notEqual(refreshSource.length, 0);

  // 订阅源有独立的轮次 ref
  assert.match(adminSource, /const contentSourcesRequestGenerationRef = useRef\(0\)/);
  assert.match(
    refreshSource,
    /contentSourcesRequestGenerationRef\.current === sourcesGeneration/
  );

  // 顺序必须是:先落地订阅源,再做内容列表的轮次判断
  const sourcesApplyIndex = refreshSource.indexOf("setContentSources(sourcesResult.value)");
  const itemsGuardIndex = refreshSource.indexOf(
    "contentItemsRequestGenerationRef.current !== generation"
  );
  assert.notEqual(sourcesApplyIndex, -1);
  assert.notEqual(itemsGuardIndex, -1);
  assert.ok(
    sourcesApplyIndex < itemsGuardIndex,
    "订阅源必须在内容轮次判断之前落地,否则被取代的那一轮会把它整份丢掉"
  );
});

test("刷新失败的提示存在，且订阅内容那条成功提示会带上它", () => {
  assert.equal(zhCategory.refreshFailedHint, "列表刷新失败，请重新加载页面。");
  assert.equal(
    enCategory.refreshFailedHint,
    "The list failed to refresh. Please reload the page."
  );

  const applySource = adminSource.slice(
    adminSource.indexOf("async function applyCategoryAction("),
    adminSource.indexOf("const adminFilterCategories = useMemo(")
  );
  assert.notEqual(applySource.length, 0);
  assert.match(applySource, /contentResult\.sourcesOk && contentResult\.itemsOk/);
  assert.match(
    applySource,
    /contentRefreshOk\s*\?\s*resultMessage\s*:\s*`\$\{resultMessage\}\$\{categoryText\.refreshFailedHint\}`/
  );
});
