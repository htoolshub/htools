import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { compileTypescriptModule } from "../helpers/compile-typescript.mjs";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const compiledValidation = await compileTypescriptModule(
  new URL("../../shared/image-upload.ts", import.meta.url)
);
const sharedStub = `data:text/javascript,${encodeURIComponent(`
  export class InvalidRequestError extends Error {}
  export async function getDatabase(env) { return env.DB; }
  export function jsonError(error, code, init) {
    return new Response(JSON.stringify({ error, code }), {
      status: init.status,
      headers: { "Content-Type": "application/json" }
    });
  }
  export function writeErrorResponse(error, fallback) {
    return jsonError(error instanceof Error ? error.message : fallback, "SERVER_ERROR", { status: 500 });
  }
`)}`;
const compiledService = await compileTypescriptModule(
  new URL("../../functions/_image-bed.ts", import.meta.url),
  {
    importReplacements: {
      "./_shared": sharedStub,
      "../shared/image-upload": compiledValidation.url.href
    }
  }
);
const validation = await import(`${compiledValidation.url.href}?image-validation=1`);
const service = await import(`${compiledService.url.href}?image-bed=1`);

test.after(async () => {
  await Promise.all([compiledValidation.cleanup(), compiledService.cleanup()]);
});

function createSettingsDatabase(initialValue = null) {
  let value = initialValue;
  return {
    get value() {
      return value;
    },
    prepare() {
      let bindings = [];
      return {
        bind(...nextBindings) {
          bindings = nextBindings;
          return this;
        },
        async first() {
          return value === null ? null : { value };
        },
        async run() {
          value = bindings[1];
          return { success: true };
        }
      };
    }
  };
}

function createFile(size, type = "image/png") {
  return new File([new Uint8Array(size)], "test.png", { type });
}

test("shared image validation accepts supported files up to 10 MB", () => {
  assert.equal(validation.ADMIN_IMAGE_UPLOAD_MAX_BYTES, 10 * 1024 * 1024);
  assert.equal(
    validation.getAdminImageUploadValidationCode(
      createFile(validation.ADMIN_IMAGE_UPLOAD_MAX_BYTES)
    ),
    ""
  );
  assert.equal(
    validation.getAdminImageUploadValidationCode(createFile(1, "text/plain")),
    "IMAGE_FILE_INVALID"
  );
  assert.equal(
    validation.getAdminImageUploadValidationCode(
      createFile(validation.ADMIN_IMAGE_UPLOAD_MAX_BYTES + 1)
    ),
    "IMAGE_FILE_TOO_LARGE"
  );
});

test("image bed settings default to disabled and never expose or store the token", async () => {
  const database = createSettingsDatabase();
  const token = "private-image-bed-token";
  const env = { DB: database, IMGBED_TOKEN: token };
  const defaults = await service.getImageBedSettings(env);

  assert.equal(defaults.available, true);
  assert.equal(defaults.enabled, false);
  assert.doesNotMatch(JSON.stringify(defaults), new RegExp(token));

  const saved = await service.saveImageBedSettings(env, {
    enabled: true,
    baseUrl: "https://img.example.com/root",
    uploadChannel: "cfr2",
    channelName: "main",
    uploadNameType: "short",
    uploadFolder: "htools/images"
  });
  assert.equal(saved.enabled, true);
  assert.equal(saved.baseUrl, "https://img.example.com/root/");
  assert.equal(saved.uploadNameType, "short");
  assert.doesNotMatch(database.value, new RegExp(token));
});

test("invalid image bed URLs fail explicitly even while the service is disabled", async () => {
  await assert.rejects(
    () => service.saveImageBedSettings(
      { DB: createSettingsDatabase(), IMGBED_TOKEN: "token" },
      {
        enabled: false,
        baseUrl: "javascript:alert(1)",
        uploadChannel: "telegram",
        channelName: "",
        uploadNameType: "default",
        uploadFolder: ""
      }
    ),
    (error) => error?.code === "IMAGE_BED_URL_INVALID"
  );
});

test("image upload enforces configuration, file type, size, and ImgBed request contract", async () => {
  const enabledSettings = JSON.stringify({
    enabled: true,
    baseUrl: "https://img.example.com/root/",
    uploadChannel: "telegram",
    channelName: "main",
    uploadNameType: "index",
    uploadFolder: "htools/images"
  });
  const disabledSettings = JSON.stringify({
    enabled: false,
    baseUrl: "https://img.example.com/",
    uploadChannel: "telegram",
    channelName: "",
    uploadFolder: ""
  });

  await assert.rejects(
    () => service.uploadImageToImageBed(
      { DB: createSettingsDatabase(enabledSettings) },
      createFile(1)
    ),
    (error) => error?.code === "IMAGE_BED_NOT_CONFIGURED"
  );
  await assert.rejects(
    () => service.uploadImageToImageBed(
      { DB: createSettingsDatabase(disabledSettings), IMGBED_TOKEN: "token" },
      createFile(1)
    ),
    (error) => error?.code === "IMAGE_BED_DISABLED"
  );
  await assert.rejects(
    () => service.uploadImageToImageBed(
      { DB: createSettingsDatabase(enabledSettings), IMGBED_TOKEN: "token" },
      createFile(1, "text/plain")
    ),
    (error) => error?.code === "IMAGE_FILE_INVALID"
  );
  await assert.rejects(
    () => service.uploadImageToImageBed(
      { DB: createSettingsDatabase(enabledSettings), IMGBED_TOKEN: "token" },
      createFile(validation.ADMIN_IMAGE_UPLOAD_MAX_BYTES + 1)
    ),
    (error) => error?.code === "IMAGE_FILE_TOO_LARGE"
  );

  const originalFetch = globalThis.fetch;
  let capturedUrl;
  let capturedInit;
  globalThis.fetch = async (url, init) => {
    capturedUrl = new URL(url);
    capturedInit = init;
    return Response.json([{ src: "/file/test.png", publicUrl: "https://cdn.example/test.png" }]);
  };
  try {
    const result = await service.uploadImageToImageBed(
      { DB: createSettingsDatabase(enabledSettings), IMGBED_TOKEN: "secret-token" },
      createFile(32)
    );
    assert.equal(result.url, "https://cdn.example/test.png");
    assert.equal(capturedUrl.pathname, "/root/upload");
    assert.equal(capturedUrl.searchParams.get("returnFormat"), "full");
    assert.equal(capturedUrl.searchParams.get("uploadChannel"), "telegram");
    assert.equal(capturedUrl.searchParams.get("channelName"), "main");
    assert.equal(capturedUrl.searchParams.get("uploadNameType"), "index");
    assert.equal(capturedUrl.searchParams.get("uploadFolder"), "htools/images");
    assert.equal(new Headers(capturedInit.headers).get("Authorization"), "Bearer secret-token");
    assert.ok(capturedInit.body instanceof FormData);
    assert.ok(capturedInit.body.get("file") instanceof File);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("admin service settings and all three image fields reuse the shared upload path", async () => {
  const [admin, card, component, settingsEndpoint, uploadEndpoint, backup, publicApp] =
    await Promise.all([
      read("../../src/AdminApp.tsx"),
      read("../../src/components/admin-settings/ImageBedSettingsCard.tsx"),
      read("../../src/components/AdminImageUploadButton.tsx"),
      read("../../functions/api/admin/image-bed-settings.ts"),
      read("../../functions/api/admin/image-upload.ts"),
      read("../../functions/api/admin/backup.ts"),
      read("../../src/App.tsx")
    ]);

  assert.equal((admin.match(/<AdminImageUploadButton\b/g) ?? []).length, 3);
  assert.equal((card.match(/<AdminSettingsFieldSkeleton \/>/g) ?? []).length, 5);
  for (const type of ["default", "index", "origin", "short"]) {
    assert.match(card, new RegExp(`\\b${type}\\b`));
  }
  assert.match(component, /getAdminImageUploadValidationCode\(file\)/);
  assert.match(settingsEndpoint, /requireAdmin\(request, env\)/);
  assert.ok(
    uploadEndpoint.indexOf("requireAdmin(request, env)") <
      uploadEndpoint.indexOf("request.formData()")
  );
  assert.match(backup, /"image_bed_settings"/);
  assert.doesNotMatch(backup, /IMGBED_TOKEN/);
  assert.doesNotMatch(publicApp, /ImageBedSettingsCard|AdminImageUploadButton/);
});
