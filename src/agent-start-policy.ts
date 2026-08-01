import type { CoreBridge } from "./types.ts";
import { cwdFromContext } from "./util.ts";
import { planSkillExpansion, type SkillExpansionPlan } from "./skills.ts";

export type AgentStartKind =
  | "generic"
  | "finder"
  | "oracle"
  | "code-reviewer"
  | "code-quality-reviewer";

export function startKindForAgentTool(toolName: string): AgentStartKind | undefined {
  switch (toolName) {
    case "agent_spawn": return "generic";
    case "finder": return "finder";
    case "oracle": return "oracle";
    case "code_reviewer": return "code-reviewer";
    case "code_quality_reviewer": return "code-quality-reviewer";
    default: return undefined;
  }
}

function rubricInstruction(kind: AgentStartKind): { readonly skill: string; readonly text: string } | undefined {
  switch (kind) {
    // ^agent-qkil / ^agent-ecr0: reviewer kinds own their rubric instructions.
    case "code-reviewer":
      return { skill: "code-review", text: "Your rubric: $code-review. Follow it exactly." };
    case "code-quality-reviewer":
      return { skill: "code-quality-review", text: "Your rubric: $code-quality-review. Follow it exactly." };
    case "generic":
    case "finder":
    case "oracle":
      return undefined;
  }
}

export type AgentStartContextPlan =
  | { readonly ok: true; readonly skillExpansion?: SkillExpansionPlan }
  | { readonly ok: false; readonly code: "rubric_unavailable"; readonly message: string };

export function planAgentStartContext(
  core: CoreBridge,
  kind: AgentStartKind,
  ctx: unknown,
): AgentStartContextPlan {
  const rubric = rubricInstruction(kind);
  if (rubric === undefined) return { ok: true };
  const skillExpansion = planSkillExpansion(core, {
    text: rubric.text,
    cwd: cwdFromContext(ctx),
    ctx,
  });
  return skillExpansion.messages.length > 0
    ? { ok: true, skillExpansion }
    : {
      ok: false,
      code: "rubric_unavailable",
      message: `reviewer rubric skill is unavailable: ${rubric.skill}`,
    };
}
