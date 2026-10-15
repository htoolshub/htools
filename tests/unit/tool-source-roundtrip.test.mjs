import assert from "node:assert/strict";
import { after, test } from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const compiledShared = await compileTypescriptModule(
  new URL("../../functions/_shared.ts", import.meta.url)
);
const compiledAdminHelpers = await compileTypescriptModule(
  new URL("../../src/admin-helpers.ts", import.meta.url)
);
const compiledToolHelpers = await compileTypescriptModule(
  new URL("../../src/tool-helpers.ts", import.meta.url),
  { importReplacements: { "./admin-helpers": compiledAdminHelpers.url.href } }
);
const compiledMaintenance = await compileTypescriptModule(
  new URL("../../src/admin-maintenance.ts", import.meta.url),
  {
    importReplacements: {
      "./admin-helpers": compiledAdminHelpers.url.href,
      "./tool-helpers": compiledToolHelpers.url.href
    }
  }
);
const compiledImport = await compileTypescriptModule(
  new URL("../../functions/api/admin/import-tools.ts", import.meta.url),
  { importReplacements: { "../../_shared": compiledShared.url.href } }
);
const shared = await import(`${compiledShared.url.href}?roundtrip-shared=1`);
const maintenance = await import(
  `${compiledMaintenance.url.href}?roundtrip-maintenance=1`
);
const importer = await import(`${compiledImport.url.href}?roundtrip-import=1`);

after(() => {
  compiledShared.cleanup();
  compiledAdminHelpers.cleanup();
  compiledToolHelpers.cleanup();
  compiledMaintenance.cleanup();
  compiledImport.cleanup();
});

test("tool source export preserves import fields and exact timestamps", () => {
  const row = {
    id: "roundtrip-tool",
    name: "Roundtrip tool",
    description: "Keeps every source field",
    url: "https://github.com/example/roundtrip",
    demo_url: "https://demo.example.test/",
    image: "https://img.example.test/cover.webp",
    category: "开发工具",
    tags: JSON.stringify(["同步", "导入"]),
    github_language: "TypeScript",
    github_license: "MIT",
    featured: 1,
    created_at: "2025-04-03T12:34:56.789Z",
    updated_at: "2026-07-17T01:02:03.456Z"
  };

  const source = shared.toolSourceFromRow(row);
  assert.deepEqual(source, {
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    id: row.id,
    name: row.name,
    description: row.description,
    url: row.url,
    demoUrl: row.demo_url,
    image: row.image,
    category: row.category,
    tags: ["同步", "导入"],
    githubLanguage: row.github_language,
    githubLicense: row.github_license,
    featured: true
  });

  const preview = maintenance.createSourcePreview([source], [], "skip", {
    sourceItemObject: "item",
    sourceRequired: (fields) => fields,
    sourceUrlInvalid: "url",
    sourceDemoUrlInvalid: "demoUrl",
    sourceImageInvalid: "image"
  });
  assert.deepEqual(preview, {
    total: 1,
    valid: 1,
    invalid: 0,
    duplicateInSource: 0,
    duplicateInSite: 0,
    willCreate: 1,
    willUpdate: 0,
    willSkip: 0,
    errors: []
  });

  const prepared = importer.prepareImportTools([source]);
  assert.equal(prepared.errors.length, 0);
  assert.equal(prepared.tools.length, 1);
  assert.deepEqual(prepared.tools[0].payload, {
    name: row.name,
    description: row.description,
    url: row.url,
    demoUrl: row.demo_url,
    image: row.image,
    category: row.category,
    tags: ["同步", "导入"],
    githubLanguage: row.github_language,
    githubLicense: row.github_license,
    featured: true
  });
  assert.equal(prepared.tools[0].createdAt, row.created_at);
  assert.equal(prepared.tools[0].updatedAt, row.updated_at);
});

test("import timestamps preserve creation time and fall back safely", () => {
  const fallback = "2026-07-17T02:00:00.000Z";
  assert.deepEqual(
    importer.resolveImportTimestamps(
      "2025-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      fallback
    ),
    {
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  );
  assert.deepEqual(
    importer.resolveImportTimestamps(null, "2026-01-01T00:00:00.000Z", fallback),
    {
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  );
  assert.deepEqual(importer.resolveImportTimestamps(null, null, fallback), {
    createdAt: fallback,
    updatedAt: fallback
  });
});

test("local htools.json files reuse the subscription source reader", async () => {
  const text = {
    sourceEmpty: "empty",
    sourceInvalid: "invalid",
    sourceFileTooLarge: "too large"
  };
  const tools = await maintenance.readToolSourceFile({
    size: 128,
    text: async () => JSON.stringify({
      tools: [{
        name: "Local source",
        description: "Imported from a file",
        url: "https://example.com/local-source",
        category: "Local"
      }]
    })
  }, text);

  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "Local source");
  await assert.rejects(
    maintenance.readToolSourceFile({
      size: 10 * 1024 * 1024 + 1,
      text: async () => "[]"
    }, text),
    /too large/
  );
  await assert.rejects(
    maintenance.readToolSourceFile({ size: 1, text: async () => "{" }, text),
    /invalid/
  );
});
