/** Tests per-agent MCP server scoping and its session tool-override projection. */
import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  isMcpServerAllowedForAgent,
  isMcpServerAllowedForAgentIds,
  resolveMcpToolOverridesForAgent,
} from "./mcp-agent-scope.js";

function configWithServers(servers: Record<string, Record<string, unknown>>): OpenClawConfig {
  return { mcp: { servers } } as unknown as OpenClawConfig;
}

const SCOPED_FINANCE = {
  finance: { command: "node", args: ["finance.mjs"], agents: ["migdalia"] },
  docs: { command: "node", args: ["docs.mjs"] },
};

describe("isMcpServerAllowedForAgent", () => {
  it("keeps a server with no agents allowlist available to every agent", () => {
    expect(isMcpServerAllowedForAgent({ command: "node" }, "max")).toBe(true);
    expect(isMcpServerAllowedForAgent({ command: "node" }, undefined)).toBe(true);
  });

  it("admits only the listed agents, matching normalized ids", () => {
    const server = { command: "node", agents: ["Migdalia"] };
    expect(isMcpServerAllowedForAgent(server, "migdalia")).toBe(true);
    expect(isMcpServerAllowedForAgent(server, "max")).toBe(false);
  });

  it.each([
    { name: "no resolved agent id", agentId: undefined, allowlist: ["migdalia"] },
    { name: "blank agent id", agentId: "   ", allowlist: ["migdalia"] },
    { name: "unrepresentable agent id", agentId: "!!", allowlist: ["main"] },
    { name: "empty allowlist", agentId: "migdalia", allowlist: [] },
    { name: "blank allowlist entries", agentId: "migdalia", allowlist: ["  "] },
    { name: "non-string allowlist entries", agentId: "migdalia", allowlist: [7] },
    { name: "non-array allowlist", agentId: "migdalia", allowlist: "migdalia" },
  ])("fails closed with $name", ({ agentId, allowlist }) => {
    expect(isMcpServerAllowedForAgent({ command: "node", agents: allowlist }, agentId)).toBe(false);
  });

  it("treats an absent allowlist and a declared one differently in the shared gate", () => {
    expect(isMcpServerAllowedForAgentIds(false, undefined, undefined)).toBe(true);
    expect(isMcpServerAllowedForAgentIds(true, undefined, "migdalia")).toBe(false);
  });
});

describe("resolveMcpToolOverridesForAgent", () => {
  it("denies a scoped server for an unlisted agent and leaves unscoped servers alone", () => {
    const overrides = resolveMcpToolOverridesForAgent(configWithServers(SCOPED_FINANCE), {
      agentId: "max",
    });

    expect(overrides?.mcpServers).toEqual({ finance: false });
  });

  it("returns the caller overrides unchanged for a listed agent", () => {
    const toolOverrides = { mcpToolsDeny: { docs: ["delete"] } };
    const overrides = resolveMcpToolOverridesForAgent(configWithServers(SCOPED_FINANCE), {
      agentId: "migdalia",
      toolOverrides,
    });

    expect(overrides).toBe(toolOverrides);
  });

  it("fails closed for every scoped server when the agent id is unresolved", () => {
    const overrides = resolveMcpToolOverridesForAgent(
      configWithServers({
        finance: { command: "node", agents: ["migdalia"] },
        bambu: { command: "node", agents: ["3d-engineer"] },
        docs: { command: "node" },
      }),
      {},
    );

    expect(overrides?.mcpServers).toEqual({ finance: false, bambu: false });
  });

  it("cannot be widened by a session override that enables the scoped server", () => {
    const overrides = resolveMcpToolOverridesForAgent(configWithServers(SCOPED_FINANCE), {
      agentId: "max",
      toolOverrides: { mcpServers: { finance: true, docs: true }, webSearch: false },
    });

    // Scope decides availability; the session may narrow it further but never widen it.
    expect(overrides?.mcpServers).toEqual({ finance: false, docs: true });
    // Unrelated session overrides survive the projection.
    expect(overrides?.webSearch).toBe(false);
  });
});
