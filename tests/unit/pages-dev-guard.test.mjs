import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { dirname, resolve } from "node:path";
import { createServer as createTcpServer } from "node:net";
import test from "node:test";
import { once } from "node:events";
import { probeHtoolsPreview } from "../../scripts/lib/preview-guard.mjs";
import { runPagesDev } from "../../scripts/pages-dev.mjs";

test("Pages dev can find npm beside Node without relying on PATH", () => {
  const bundledNpm = resolve(
    dirname(process.execPath),
    process.platform === "win32" ? "node_modules/npm/bin/npm-cli.js" : "npm"
  );

  assert.equal(existsSync(bundledNpm), true);
});

const HEALTHY_SETTINGS = {
  settings: {
    name: "HTools",
    subtitle: "Tools",
    iconUrl: "",
    aboutContent: { zh: "", en: "" },
    footer: {
      description: "Tools",
      socialLinks: [],
      groups: []
    }
  }
};

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function close(server) {
  server.close();
  await once(server, "close");
}

test("preview probe recognizes a healthy HTools Pages instance", async () => {
  const server = createHttpServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("X-HTools-Cache", "MISS");
    response.end(JSON.stringify(HEALTHY_SETTINGS));
  });
  const port = await listen(server);

  try {
    const result = await probeHtoolsPreview({ port, timeoutMs: 300 });
    assert.equal(result.status, "healthy-htools");
  } finally {
    await close(server);
  }
});

test("preview probe requires the HTools response signature", async () => {
  const server = createHttpServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(HEALTHY_SETTINGS));
  });
  const port = await listen(server);

  try {
    const result = await probeHtoolsPreview({ port, timeoutMs: 300 });
    assert.equal(result.status, "occupied-http-other");
  } finally {
    await close(server);
  }
});

test("preview probe rejects a different HTTP service on the same port", async () => {
  const server = createHttpServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ service: "other" }));
  });
  const port = await listen(server);

  try {
    const result = await probeHtoolsPreview({ port, timeoutMs: 300 });
    assert.equal(result.status, "occupied-http-other");
  } finally {
    await close(server);
  }
});

test("preview probe distinguishes a listening but unresponsive process", async () => {
  const sockets = new Set();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const port = await listen(server);

  try {
    const result = await probeHtoolsPreview({ port, timeoutMs: 100 });
    assert.equal(result.status, "occupied-unresponsive");
  } finally {
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});

test("preview probe treats stalled HTTP response bodies as unresponsive", async () => {
  const sockets = new Set();
  const server = createHttpServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.flushHeaders();
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  const port = await listen(server);

  try {
    const result = await probeHtoolsPreview({ port, timeoutMs: 100 });
    assert.equal(result.status, "occupied-unresponsive");
  } finally {
    for (const socket of sockets) socket.destroy();
    await close(server);
  }
});

test("preview probe reports a released port as free", async () => {
  const server = createTcpServer();
  const port = await listen(server);
  await close(server);

  const result = await probeHtoolsPreview({ port, timeoutMs: 100 });
  assert.equal(result.status, "free");
});

test("healthy preview is rebuilt and reused without another Wrangler", async () => {
  const calls = [];
  const logs = [];
  const statuses = ["healthy-htools", "healthy-htools"];
  const exitCode = await runPagesDev({
    probe: async () => ({
      status: statuses.shift(),
      origin: "http://127.0.0.1:8788"
    }),
    build: async () => {
      calls.push("build");
      return 0;
    },
    start: async () => {
      calls.push("start");
      return 0;
    },
    log: (message) => logs.push(message)
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, ["build"]);
  assert.equal(logs.length, 2);
});

test("free port builds first and starts exactly one Wrangler", async () => {
  const calls = [];
  const statuses = ["free", "free"];
  const exitCode = await runPagesDev({
    probe: async () => ({
      status: statuses.shift(),
      origin: "http://127.0.0.1:8788"
    }),
    build: async () => {
      calls.push("build");
      return 0;
    },
    start: async () => {
      calls.push("start");
      return 0;
    },
    log: () => undefined
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, ["build", "start"]);
});

test("occupied or unresponsive ports fail before build and startup", async () => {
  for (const status of ["occupied-http-other", "occupied-unresponsive"]) {
    const calls = [];
    const errors = [];
    const exitCode = await runPagesDev({
      probe: async () => ({ status, origin: "http://127.0.0.1:8788" }),
      build: async () => {
        calls.push("build");
        return 0;
      },
      start: async () => {
        calls.push("start");
        return 0;
      },
      error: (message) => errors.push(message)
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(calls, []);
    assert.equal(errors.length, 1);
  }
});

test("a port claimed during build is not given a second Wrangler", async () => {
  const calls = [];
  const statuses = ["free", "occupied-http-other"];
  const exitCode = await runPagesDev({
    probe: async () => ({
      status: statuses.shift(),
      origin: "http://127.0.0.1:8788"
    }),
    build: async () => {
      calls.push("build");
      return 0;
    },
    start: async () => {
      calls.push("start");
      return 0;
    },
    error: () => undefined
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(calls, ["build"]);
});

test("a concurrent HTools preview that wins startup is reused successfully", async () => {
  const calls = [];
  const logs = [];
  const statuses = ["free", "free", "healthy-htools"];
  const exitCode = await runPagesDev({
    probe: async () => ({
      status: statuses.shift(),
      origin: "http://127.0.0.1:8788"
    }),
    build: async () => {
      calls.push("build");
      return 0;
    },
    start: async () => {
      calls.push("start");
      return 1;
    },
    log: (message) => logs.push(message)
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(calls, ["build", "start"]);
  assert.match(logs.at(-1), /继续复用/);
});
