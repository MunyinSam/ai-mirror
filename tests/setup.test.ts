import { describe, expect, test } from "bun:test";
import { mergeHookSettings } from "../src/commands/setup.ts";

describe("mergeHookSettings", () => {
  const CMD = "bun run D:/Code-3/ai-mirror/src/hook.ts";

  test("adds our hook without touching other hooks", () => {
    const settings = {
      hooks: {
        PostToolUse: [
          { matcher: "Bash", hooks: [{ type: "command", command: "other-tool log" }] },
        ],
        UserPromptSubmit: [{ hooks: [{ type: "command", command: "something" }] }],
      },
    };
    const merged = mergeHookSettings(settings, CMD) as {
      hooks: { PostToolUse: unknown[]; UserPromptSubmit: unknown[] };
    };
    expect(merged.hooks.PostToolUse).toHaveLength(2);
    expect(merged.hooks.UserPromptSubmit).toHaveLength(1);
  });

  test("replaces a stale ai-mirror entry instead of duplicating", () => {
    const settings = {
      hooks: {
        PostToolUse: [
          {
            matcher: "Edit|Write",
            hooks: [{ type: "command", command: "bun run D:/old/ai-mirror/hooks/post-tool-use.ts" }],
          },
        ],
      },
    };
    const merged = mergeHookSettings(settings, CMD) as {
      hooks: { PostToolUse: { hooks: { command: string }[] }[] };
    };
    expect(merged.hooks.PostToolUse).toHaveLength(1);
    expect(merged.hooks.PostToolUse[0]!.hooks[0]!.command).toBe(CMD);
  });

  test("works on empty settings", () => {
    const merged = mergeHookSettings({}, CMD) as { hooks: { PostToolUse: unknown[] } };
    expect(merged.hooks.PostToolUse).toHaveLength(1);
  });
});
