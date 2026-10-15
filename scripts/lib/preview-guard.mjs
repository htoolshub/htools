import { createConnection } from "node:net";

export const DEFAULT_PAGES_HOST = "127.0.0.1";
export const DEFAULT_PAGES_PORT = 8788;
export const DEFAULT_PREVIEW_TIMEOUT_MS = 1800;

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

export function isHtoolsSiteSettingsPayload(value) {
  const settings = value?.settings;

  return Boolean(
    settings &&
      typeof settings === "object" &&
      typeof settings.name === "string" &&
      typeof settings.subtitle === "string" &&
      typeof settings.iconUrl === "string" &&
      settings.aboutContent &&
      typeof settings.aboutContent === "object" &&
      typeof settings.aboutContent.zh === "string" &&
      typeof settings.aboutContent.en === "string" &&
      settings.footer &&
      typeof settings.footer === "object" &&
      typeof settings.footer.description === "string" &&
      hasOwn(settings.footer, "socialLinks") &&
      Array.isArray(settings.footer.socialLinks) &&
      hasOwn(settings.footer, "groups") &&
      Array.isArray(settings.footer.groups)
  );
}

export function hasHtoolsResponseSignature(response) {
  const cacheStatus = response.headers.get("x-htools-cache");
  return cacheStatus === "HIT" || cacheStatus === "MISS" || cacheStatus === "BYPASS";
}

export function canConnectToPort({
  host = DEFAULT_PAGES_HOST,
  port = DEFAULT_PAGES_PORT,
  timeoutMs = DEFAULT_PREVIEW_TIMEOUT_MS
} = {}) {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    let settled = false;

    function finish(connected) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(connected);
    }

    socket.setTimeout(timeoutMs, () => finish(true));
    socket.once("connect", () => finish(true));
    socket.once("error", (error) =>
      finish(error?.code !== "ECONNREFUSED")
    );
  });
}

export async function probeHtoolsPreview({
  host = DEFAULT_PAGES_HOST,
  port = DEFAULT_PAGES_PORT,
  timeoutMs = DEFAULT_PREVIEW_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
  connectImpl = canConnectToPort
} = {}) {
  const origin = `http://${host}:${port}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let receivedHttpResponse = false;

  try {
    const response = await fetchImpl(
      `${origin}/api/site-settings?scope=basic&preview_guard=${Date.now()}`,
      {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal: controller.signal
      }
    );
    receivedHttpResponse = true;

    if (!response.ok) {
      return { status: "occupied-http-other", origin };
    }

    const payload = await response.json();
    return {
      status:
        hasHtoolsResponseSignature(response) &&
        isHtoolsSiteSettingsPayload(payload)
        ? "healthy-htools"
        : "occupied-http-other",
      origin
    };
  } catch {
    if (controller.signal.aborted) {
      const connected = await connectImpl({ host, port, timeoutMs });
      return {
        status: connected ? "occupied-unresponsive" : "free",
        origin
      };
    }

    if (receivedHttpResponse) {
      return { status: "occupied-http-other", origin };
    }

    const connected = await connectImpl({ host, port, timeoutMs });
    return {
      status: connected ? "occupied-unresponsive" : "free",
      origin
    };
  } finally {
    clearTimeout(timeout);
  }
}
