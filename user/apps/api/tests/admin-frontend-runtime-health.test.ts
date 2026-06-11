import assert from "node:assert/strict";
import test from "node:test";
import { inspectFrontendRuntime } from "../src/modules/admin/frontend-runtime-health.js";

test("frontend runtime accepts reachable html endpoints", () => {
  const result = inspectFrontendRuntime([
    {
      endpoint: "web",
      url: "http://127.0.0.1:3100/",
      ok: true,
      statusCode: 200,
      contentType: "text/html; charset=utf-8",
      durationMs: 12,
      error: null
    },
    {
      endpoint: "admin",
      url: "http://127.0.0.1:3101/",
      ok: true,
      statusCode: 200,
      contentType: "text/html",
      durationMs: 9,
      error: null
    }
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.status, "ok");
  assert.equal(result.summary.okEndpoints, 2);
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
