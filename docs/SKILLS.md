# Agent Skills

This repository includes a portable agent skill for using LEaps Image Viewer through MCP tools:

```text
skills/leaps-image-viewer-agent/SKILL.md
```

The skill is written as a plain `SKILL.md` file so it can be reused by Codex, Claude, or any other agent runtime that supports skill-like instruction bundles.

## What The Skill Teaches

The skill tells an agent how to:

- treat the viewer as a stateful image workbench,
- alternate tool actions with `viewer_observe`,
- use image pixel coordinates consistently,
- inspect Bayer/raw frames without trusting screenshots as raw data,
- control viewport state with `viewer_zoom`, `viewer_pan`, `viewer_fit`, and `viewer_set_viewport`,
- run compare-mode loss inspection,
- save ROIs with descriptions that later agents can understand.

## Portable Use

For any agent that can read files, provide this file as task context:

```text
skills/leaps-image-viewer-agent/SKILL.md
```

Then ask the agent to follow it before using the LEaps Image Viewer MCP tools.

Minimal prompt:

```text
Read skills/leaps-image-viewer-agent/SKILL.md and follow it.
Use the LEaps Image Viewer MCP tools as a stateful workbench.
Always call viewer_observe after opening a source and after each visual manipulation.
Report ROI coordinates in image pixels.
```

## Codex Use

Copy or reference the skill directory from a Codex workspace:

```text
skills/leaps-image-viewer-agent/
```

Then instruct Codex:

```text
Use the leaps-image-viewer-agent skill from this repository.
Inspect the image through MCP tools and save any ROI used as evidence.
```

If Codex is running inside this repository, it can read the skill directly from the repo path.

## Claude Use

For Claude or Claude Code, include the same `SKILL.md` file in the project context or copy the directory into the runtime's skill location if supported.

Prompt pattern:

```text
Use the instructions in skills/leaps-image-viewer-agent/SKILL.md.
Drive LEaps Image Viewer through MCP tools.
Do not rely on screenshots for raw Bayer values; use pixel and ROI tools for evidence.
```

## Generic MCP Agent Use

The skill assumes the agent has access to the LEaps Image Viewer MCP server.

Expected project-local MCP registration:

```json
{
  "mcpServers": {
    "leaps-image-viewer": {
      "command": "node",
      "args": ["mcp/server.mjs"],
      "env": {
        "LEAPS_VIEWER_URL": "http://127.0.0.1:5173/",
        "LEAPS_BRIDGE_URL": "ws://127.0.0.1:8787"
      }
    }
  }
}
```

Keep the MCP registration project-local unless the user explicitly wants it globally available.

## Smoke Test

Before relying on the skill in a new agent runtime, verify the MCP server:

```bash
npm run verify:mcp
```

The expected result is a passing smoke test with the registered tool count. The current server exposes viewport, ROI, screenshot, Bayer, and compare tools.

## Maintenance

When the MCP tool list changes, update:

- `skills/leaps-image-viewer-agent/SKILL.md`,
- `docs/MCP_SERVER.md`,
- `docs/AGENT_OPERATION_GUIDE.md`,
- this document.

The skill should remain concise, operational, and tool-oriented. Put deep implementation details in regular docs instead of the skill.
