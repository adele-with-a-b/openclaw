/**
 * Per-agent MCP server scoping shared by every runtime.
 *
 * `mcp.servers.<name>.agents` is an OpenClaw-side allowlist of agent ids. Any
 * runtime that resolves MCP servers for an agent turn projects the decision into
 * its session tool overrides through `resolveMcpToolOverridesForAgent`, before
 * credentials resolve or transports open. Session overrides may narrow that
 * result, but cannot widen it.
 */
import { normalizeConfiguredMcpServers } from "../config/mcp-config-normalize.js";
import type { SessionToolOverrides } from "../config/sessions/types.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { isValidAgentId, normalizeAgentId } from "../routing/session-key.js";

function normalizeAgentIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => isValidAgentId(entry))
    .map((entry) => normalizeAgentId(entry));
}

/**
 * Fail-closed allowlist gate shared by the generic `agents` field and Codex's
 * `codex.agents`. No declared allowlist keeps the historical default of every
 * agent. A declared allowlist that is empty, invalid, or evaluated without a
 * resolved agent id hides the server instead of widening it to every agent.
 */
export function isMcpServerAllowedForAgentIds(
  hasAllowlist: boolean,
  allowlist: unknown,
  agentId: string | undefined,
): boolean {
  if (!hasAllowlist) {
    return true;
  }
  const agentIds = normalizeAgentIds(allowlist);
  // An unrepresentable agent id normalizes to the default agent id, so it is
  // rejected here rather than compared: a scoped server must never resolve
  // through a placeholder identity.
  if (agentIds.length === 0 || !isValidAgentId(agentId)) {
    return false;
  }
  return agentIds.includes(normalizeAgentId(agentId));
}

/** Reads the generic per-server `agents` allowlist that applies to every runtime. */
export function isMcpServerAllowedForAgent(
  server: Record<string, unknown>,
  agentId: string | undefined,
): boolean {
  return isMcpServerAllowedForAgentIds(Object.hasOwn(server, "agents"), server.agents, agentId);
}

/**
 * Projects a server-scope decision into session tool overrides. Denials use the
 * `mcpServers[name] = false` channel session overrides already own, so every MCP
 * loader, runtime, and native projection honors the scope through one seam.
 */
export function applyMcpServerScopeDenials(params: {
  cfg: OpenClawConfig | undefined;
  toolOverrides?: SessionToolOverrides;
  isAllowed: (server: Record<string, unknown>) => boolean;
}): SessionToolOverrides | undefined {
  const deniedServerNames = Object.entries(normalizeConfiguredMcpServers(params.cfg?.mcp?.servers))
    .filter(([, server]) => !params.isAllowed(server))
    .map(([name]) => name);
  if (deniedServerNames.length === 0) {
    return params.toolOverrides;
  }
  const mcpServers = { ...params.toolOverrides?.mcpServers };
  for (const serverName of deniedServerNames) {
    mcpServers[serverName] = false;
  }
  return { ...params.toolOverrides, mcpServers };
}

/** Applies the generic `agents` allowlist for a resolved agent turn. */
export function resolveMcpToolOverridesForAgent(
  cfg: OpenClawConfig | undefined,
  options: { agentId?: string; toolOverrides?: SessionToolOverrides },
): SessionToolOverrides | undefined {
  return applyMcpServerScopeDenials({
    cfg,
    toolOverrides: options.toolOverrides,
    isAllowed: (server) => isMcpServerAllowedForAgent(server, options.agentId),
  });
}
