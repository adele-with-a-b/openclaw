/**
 * Proves per-agent MCP scoping on the CLI-runner path: the generated Claude
 * `--mcp-config` handed to the backend must omit servers scoped to other agents.
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { retireSessionMcpRuntime } from "../agent-bundle-mcp-manager-api.js";
import { testing as cliBackendsTesting } from "../cli-backends.test-support.js";
import {
  buildDefaultTestCliBackend,
  createCliRunnerPrepareFixture,
  createTestMcpLoopbackClientGrant,
  createTestMcpLoopbackServer,
  createTestMcpLoopbackServerConfig,
} from "../cli-runner.test-helpers.js";
import {
  requireMcpConfigPath,
  setupCliBundleMcpTestHarness,
  writeCliMcpPolicyProbeServer,
} from "./bundle-mcp.test-support.js";
import { prepareCliRunContext } from "./prepare.js";
import {
  resetCliRunnerPrepareTestDeps,
  setCliRunnerPrepareTestDeps,
} from "./prepare.test-support.js";

setupCliBundleMcpTestHarness();

const SESSION_ID = "session-test";

function configWithScopedFinance(probeServerPath: string): OpenClawConfig {
  return {
    plugins: { enabled: false },
    agents: { entries: { main: {}, migdalia: {} } },
    mcp: {
      servers: {
        finance: { command: process.execPath, args: [probeServerPath], agents: ["migdalia"] },
        docs: { command: process.execPath, args: [probeServerPath] },
      },
    },
  } as unknown as OpenClawConfig;
}

function readGeneratedMcpServers(args: readonly string[] | undefined): Record<string, unknown> {
  const raw = JSON.parse(fs.readFileSync(requireMcpConfigPath(args), "utf-8")) as {
    mcpServers?: Record<string, unknown>;
  };
  return raw.mcpServers ?? {};
}

describe("CLI runner per-agent MCP scoping", () => {
  let fixture: ReturnType<typeof createCliRunnerPrepareFixture>;

  beforeEach(() => {
    cliBackendsTesting.setDepsForTest({
      resolvePluginSetupCliBackend: () => undefined,
      resolveRuntimeCliBackends: () => [buildDefaultTestCliBackend({ bundleMcp: true })],
    });
    setCliRunnerPrepareTestDeps({
      isWorkspaceBootstrapPending: async () => false,
      resolveBootstrapContextForRun: async () => ({ bootstrapFiles: [], contextFiles: [] }),
      resolveOpenClawReferencePaths: async () => ({ docsPath: null, sourcePath: null }),
      prepareClaudeCliSkillsPlugin: async () => ({ args: [], cleanup: async () => {} }),
      loadManifestModelCatalog: () => [],
      getActiveMcpLoopbackRuntime: vi.fn(() => ({
        port: 31783,
        ownerToken: "loopback-owner-token",
        nonOwnerToken: "loopback-non-owner-token",
      })),
      ensureMcpLoopbackServer: vi.fn(createTestMcpLoopbackServer),
      createMcpLoopbackServerConfig: vi.fn(createTestMcpLoopbackServerConfig),
      mintMcpLoopbackClientGrant: vi.fn(createTestMcpLoopbackClientGrant),
      bindMcpLoopbackClientGrantAdmission: vi.fn(() => true),
      resolveMcpLoopbackScopedTools: vi.fn(() => ({ agentId: "main", tools: [] })),
    });
    fixture = createCliRunnerPrepareFixture(prepareCliRunContext);
  });

  afterEach(async () => {
    // The native MCP policy pass connects the probe servers; retire the session
    // runtime so no stdio child outlives the test.
    await retireSessionMcpRuntime({ sessionId: SESSION_ID, reason: "test-complete" });
    resetCliRunnerPrepareTestDeps();
    cliBackendsTesting.resetDepsForTest();
    fixture.cleanup();
  });

  it.each([
    { name: "omits a server scoped to another agent", sessionAgentId: "main", expected: false },
    { name: "serves a server scoped to this agent", sessionAgentId: "migdalia", expected: true },
  ])("$name", async ({ sessionAgentId, expected }) => {
    const probeServerPath = await writeCliMcpPolicyProbeServer();
    let cleanup: (() => Promise<void>) | undefined;
    try {
      const context = await fixture.prepare({
        sessionKey: `agent:${sessionAgentId}:main`,
        agentId: sessionAgentId,
        config: configWithScopedFinance(probeServerPath),
      });
      cleanup = context.preparedBackend.cleanup;

      const mcpServers = readGeneratedMcpServers(context.preparedBackend.backend.args);
      // The scope decides what the CLI process can reach at all: a denied server
      // never enters the config file the backend is launched with.
      expect(Object.hasOwn(mcpServers, "finance")).toBe(expected);
      expect(mcpServers).toHaveProperty("docs");
    } finally {
      await cleanup?.();
    }
  });
});
