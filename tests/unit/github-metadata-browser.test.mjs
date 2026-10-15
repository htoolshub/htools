import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const sourceUrl = new URL("../../src/github-metadata.ts", import.meta.url);
const compiled = await compileTypescriptModule(sourceUrl, {
  transformSource(source) {
    return source
      .replace(/import type \{ GitHubToolMetadata \} from "\.\/types";\r?\n/, "")
      .replace(
        /import \{ getGitHubRepoPath, normalizeHttpUrlInput \} from "\.\/tool-helpers";\r?\n/,
        `const normalizeHttpUrlInput = (value) => {
          const trimmed = String(value ?? "").trim();
          if (!trimmed) return "";
          return /^[a-z][a-z0-9+.-]*:\\/\\//i.test(trimmed) ? trimmed : \`https://\${trimmed}\`;
        };
        const getGitHubRepoPath = (value) => {
          try {
            const url = new URL(value);
            if (!["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) return "";
            const [owner, repo] = url.pathname.split("/").filter(Boolean).slice(0, 2);
            return owner && repo ? \`\${owner}/\${repo.replace(/\\.git$/i, "")}\` : "";
          } catch { return ""; }
        };
        `
      );
  }
});
const githubMetadata = await import(`${compiled.url.href}?browser-github=1`);

test.after(async () => {
  await compiled.cleanup();
});

test("browser GitHub metadata maps public repository fields and caches each repository", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify({
      name: "demo",
      full_name: "owner/demo",
      description: "Public demo repository",
      html_url: "https://github.com/owner/demo",
      homepage: "https://demo.example.com",
      owner: { login: "owner" },
      private: false,
      language: "TypeScript",
      license: { name: "MIT License", spdx_id: "MIT" },
      topics: ["cloudflare", "tools", "cloudflare"],
      stargazers_count: 12,
      forks_count: 3,
      updated_at: "2026-07-19T00:00:00Z"
    }), { status: 200 });
  };

  const first = await githubMetadata.loadBrowserGitHubMetadata(
    "github.com/owner/demo",
    { fetchImpl }
  );
  const second = await githubMetadata.loadBrowserGitHubMetadata(
    "https://github.com/owner/demo",
    { fetchImpl }
  );
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
  assert.deepEqual(first, {
    owner: "owner",
    repo: "demo",
    fullName: "owner/demo",
    name: "demo",
    description: "Public demo repository",
    url: "https://github.com/owner/demo",
    demoUrl: "https://demo.example.com/",
    image: "https://opengraph.githubassets.com/htools/owner/demo",
    stars: 12,
    forks: 3,
    language: "TypeScript",
    license: "MIT",
    topics: ["cloudflare", "tools"],
    updatedAt: "2026-07-19T00:00:00Z"
  });
});

test("browser metadata rejects invalid, missing, private, and rate-limited repositories", async () => {
  await assert.rejects(
    githubMetadata.loadBrowserGitHubMetadata("https://example.com/repo"),
    (error) => error.code === "GITHUB_URL_INVALID"
  );
  await assert.rejects(
    githubMetadata.loadBrowserGitHubMetadata("https://github.com/owner/missing", {
      fetchImpl: async () => new Response("{}", { status: 404 })
    }),
    (error) => error.code === "GITHUB_REPOSITORY_NOT_FOUND"
  );
  await assert.rejects(
    githubMetadata.loadBrowserGitHubMetadata("https://github.com/owner/private", {
      fetchImpl: async () => new Response(JSON.stringify({ private: true }), { status: 200 })
    }),
    (error) => error.code === "GITHUB_REPOSITORY_NOT_FOUND"
  );
  await assert.rejects(
    githubMetadata.loadBrowserGitHubMetadata("https://github.com/owner/limited", {
      fetchImpl: async () => new Response("{}", {
        status: 403,
        headers: { "x-ratelimit-remaining": "0" }
      })
    }),
    (error) => error.code === "GITHUB_RATE_LIMITED"
  );
});

test("browser GitHub metadata stops after its request timeout", async () => {
  await assert.rejects(
    githubMetadata.loadBrowserGitHubMetadata("https://github.com/owner/timeout", {
      timeoutMs: 20,
      fetchImpl: (_input, init = {}) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("The operation was aborted.", "AbortError")),
            { once: true }
          );
        })
    }),
    (error) => error.code === "GITHUB_METADATA_TIMEOUT"
  );
});

test("admin uses Pages Functions only with a token and otherwise falls back to the browser", async () => {
  const [endpoint, adminApi, submitPage] = await Promise.all([
    readFile(new URL("../../functions/api/admin/github-metadata.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/admin-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../../src/SubmitPage.tsx", import.meta.url), "utf8")
  ]);

  assert.match(endpoint, /if \(!env\.GITHUB_TOKEN\?\.trim\(\)\)/);
  assert.match(endpoint, /GITHUB_TOKEN_NOT_CONFIGURED/);
  assert.match(endpoint, /token: env\.GITHUB_TOKEN/);
  assert.match(adminApi, /"status" in error[\s\S]*error\.status === 409/);
  assert.match(adminApi, /adminGitHubMetadataMode === "browser"/);
  assert.match(adminApi, /adminGitHubMetadataMode = "server"/);
  assert.match(adminApi, /loadBrowserGitHubMetadata\(url,/);
  assert.match(submitPage, /loadBrowserGitHubMetadata\(sourceUrl, \{ forceRefresh \}\)/);
  assert.match(submitPage, /forceRefresh: false,[\s\S]*overwriteExisting: false/);
  assert.match(submitPage, /forceRefresh: true,[\s\S]*overwriteExisting: true/);
  assert.match(submitPage, /scheduleAutomaticProjectLookup\(event\.target\.value\)/);
  assert.match(submitPage, /runAutomaticProjectLookup\(form\.url, true\)/);
  assert.match(endpoint, /GITHUB_METADATA_TIMEOUT/);
  assert.match(endpoint, /status: 504/);
  assert.match(adminApi, /timeoutMs: 12_000/);
  assert.doesNotMatch(submitPage, /GITHUB_TOKEN|\/api\/admin\/github-metadata/);
});
