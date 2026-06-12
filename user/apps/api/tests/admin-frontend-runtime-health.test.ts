import assert from "node:assert/strict";
import test from "node:test";
import { extractFrontendAssetReferences, inspectFrontendRuntime } from "../src/modules/admin/frontend-runtime-health.js";

test("frontend runtime accepts reachable html endpoints", () => {
  const result = inspectFrontendRuntime([
    {
      endpoint: "web",
      url: "http://127.0.0.1:3100/",
      ok: true,
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      durationMs: 12,
      error: null,
      assetProbes: [
        {
          endpoint: "web",
          endpointUrl: "http://127.0.0.1:3100/",
          assetType: "script",
          assetUrl: "http://127.0.0.1:3100/assets/index.js",
          ok: true,
          statusCode: 200,
          contentType: "text/javascript",
          durationMs: 4,
          error: null
        },
        {
          endpoint: "web",
          endpointUrl: "http://127.0.0.1:3100/",
          assetType: "stylesheet",
          assetUrl: "http://127.0.0.1:3100/assets/index.css",
          ok: true,
          statusCode: 200,
          contentType: "text/css",
          durationMs: 3,
          error: null
        }
      ]
    },
    {
      endpoint: "admin",
      url: "http://127.0.0.1:3101/",
      ok: true,
      statusCode: 200,
      contentType: "text/html",
      durationMs: 9,
      error: null,
      assetProbes: [
        {
          endpoint: "admin",
          endpointUrl: "http://127.0.0.1:3101/",
          assetType: "script",
          assetUrl: "http://127.0.0.1:3101/assets/admin.js",
          ok: true,
          statusCode: 200,
          contentType: "application/javascript",
          durationMs: 4,
          error: null
        }
      ]
    }
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.status, "ok");
  assert.equal(result.summary.okEndpoints, 2);
  assert.equal(result.summary.totalAssets, 3);
  assert.equal(result.summary.okAssets, 3);
  assert.equal(result.summary.failedAssets, 0);
  assert.deepEqual(result.issues, []);
});

test("frontend runtime warns when an endpoint url is missing", () => {
  const result = inspectFrontendRuntime([
    {
      endpoint: "web",
      url: "http://127.0.0.1:3100/",
      ok: true,
      statusCode: 200,
      contentType: "text/html",
      durationMs: 10,
      error: null
    },
    {
      endpoint: "admin",
      url: null,
      ok: false,
      statusCode: null,
      contentType: null,
      durationMs: null,
      error: "missing_url"
    }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.status, "warning");
  assert.equal(result.summary.missingEndpoints, 1);
  assert.equal(result.issues[0].type, "frontend_endpoint_missing");
  assert.equal(result.issues[0].severity, "warning");
  assert.equal(result.issues[0].endpoint, "admin");
});

test("frontend runtime reports bad status and unreachable endpoints as errors", () => {
  const result = inspectFrontendRuntime([
    {
      endpoint: "web",
      url: "http://127.0.0.1:3100/",
      ok: false,
      statusCode: 500,
      contentType: "text/html",
      durationMs: 31,
      error: null
    },
    {
      endpoint: "admin",
      url: "http://127.0.0.1:3101/",
      ok: false,
      statusCode: null,
      contentType: null,
      durationMs: 3000,
      error: "This operation was aborted"
    }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.equal(result.summary.failedEndpoints, 2);
  assert.equal(result.issues.map((issue) => issue.type).join(","), "frontend_endpoint_bad_status,frontend_endpoint_unreachable");
});

test("frontend runtime reports non-html responses as errors", () => {
  const result = inspectFrontendRuntime([
    {
      endpoint: "web",
      url: "http://127.0.0.1:3100/",
      ok: true,
      statusCode: 200,
      contentType: "application/json",
      durationMs: 8,
      error: null
    }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.equal(result.summary.nonHtmlEndpoints, 1);
  assert.equal(result.issues[0].type, "frontend_endpoint_non_html");
});

test("frontend runtime reports missing built assets as errors", () => {
  const result = inspectFrontendRuntime([
    {
      endpoint: "admin",
      url: "http://127.0.0.1:3101/",
      ok: true,
      statusCode: 200,
      contentType: "text/html",
      durationMs: 8,
      error: null,
      assetProbes: []
    }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.equal(result.summary.endpointsWithoutAssets, 1);
  assert.equal(result.issues[0].type, "frontend_assets_missing");
});

test("frontend runtime reports broken asset references as errors", () => {
  const result = inspectFrontendRuntime([
    {
      endpoint: "web",
      url: "http://127.0.0.1:3100/",
      ok: true,
      statusCode: 200,
      contentType: "text/html",
      durationMs: 8,
      error: null,
      assetProbes: [
        {
          endpoint: "web",
          endpointUrl: "http://127.0.0.1:3100/",
          assetType: "script",
          assetUrl: "http://127.0.0.1:3100/assets/missing.js",
          ok: false,
          statusCode: 404,
          contentType: "text/html",
          durationMs: 5,
          error: null
        },
        {
          endpoint: "web",
          endpointUrl: "http://127.0.0.1:3100/",
          assetType: "stylesheet",
          assetUrl: "http://127.0.0.1:3100/assets/index.css",
          ok: true,
          statusCode: 200,
          contentType: "text/html",
          durationMs: 4,
          error: null
        }
      ]
    }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.status, "error");
  assert.equal(result.summary.totalAssets, 2);
  assert.equal(result.summary.failedAssets, 2);
  assert.deepEqual(result.issues.map((issue) => issue.type), ["frontend_asset_bad_status", "frontend_asset_bad_content_type"]);
});

test("extracts frontend script and stylesheet references from Vite html", () => {
  assert.deepEqual(extractFrontendAssetReferences(`
    <html>
      <head>
        <link rel="modulepreload" href="/assets/preload.js">
        <link rel="stylesheet" href="/assets/index.css">
      </head>
      <body>
        <script type="module" src="/assets/index.js"></script>
        <script src="https://cdn.example.test/ignored-but-valid.js"></script>
      </body>
    </html>
  `, "http://127.0.0.1:3100/app/"), [
    { assetType: "script", assetUrl: "http://127.0.0.1:3100/assets/index.js" },
    { assetType: "script", assetUrl: "https://cdn.example.test/ignored-but-valid.js" },
    { assetType: "stylesheet", assetUrl: "http://127.0.0.1:3100/assets/index.css" }
  ]);
});
