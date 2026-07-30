import Type from "typebox";

export const AgentTierSchema = Type.Union(
  [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
  { description: "The generic agent's capacity tier. Defaults to medium." },
);

export const AgentIsolationSchema = Type.Union(
  [Type.Literal("none"), Type.Literal("worktree")],
  {
    description:
      "Workspace isolation for the new identity: none (default) uses the bound parent workspace; worktree creates a dedicated Git worktree.",
  },
);

export const AgentSpawnParamsSchema = Type.Object(
  {
    message: Type.String({
      minLength: 1,
      description:
        "The agent's initial instruction. Include the desired outcome, scope, relevant context, constraints, validation, and expected result.",
    }),
    description: Type.String({
      minLength: 1,
      description:
        "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child.",
    }),
    tier: Type.Optional(AgentTierSchema),
    isolation: Type.Optional(AgentIsolationSchema),
  },
  { $id: "AgentSpawnParams", additionalProperties: false },
);

export const FinderParamsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description:
        "The discovery query. Be specific and include relevant terms, file types, expected content or naming patterns, and clear success criteria.",
    }),
    description: Type.String({
      minLength: 1,
      description:
        "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child.",
    }),
    isolation: Type.Optional(AgentIsolationSchema),
  },
  { $id: "FinderParams", additionalProperties: false },
);

export const OracleParamsSchema = Type.Object(
  {
    message: Type.String({
      minLength: 1,
      description:
        "The Oracle's initial instruction. Include the guidance, decision, or review needed, relevant context and constraints, available evidence, and attempted approaches.",
    }),
    description: Type.String({
      minLength: 1,
      description:
        "A specific, action-oriented three-to-five-word label written for the user and used for compact TUI display. This label is not sent to the child.",
    }),
    isolation: Type.Optional(AgentIsolationSchema),
  },
  { $id: "OracleParams", additionalProperties: false },
);

export const AgentSendParamsSchema = Type.Object(
  {
    agent_id: Type.String({
      minLength: 1,
      description: "The owner-scoped agent handle returned by agent_spawn, finder, oracle, or agent_list.",
    }),
    message: Type.Optional(Type.String({
      description:
        "The instruction to start idle work, steer active work, resume suspended work, or replace interrupted work. Omit only to interrupt without replacement.",
    })),
    description: Type.Optional(Type.String({
      minLength: 1,
      description:
        "A required three-to-five-word user-facing label for the message, used in compact TUI display and not sent to the child.",
    })),
    interrupt: Type.Optional(Type.Boolean({
      description:
        "When true, interrupt active work before sending a message, suspend active work when message is omitted, and have no additional effect when no active execution exists.",
    })),
  },
  { $id: "AgentSendParams", additionalProperties: false },
);

export const AgentWaitParamsSchema = Type.Object(
  {
    run_ids: Type.Array(Type.String({ minLength: 1 }), {
      minItems: 1,
      description: "Unique owner-scoped run IDs that all belong to the current session.",
    }),
    timeout_seconds: Type.Optional(Type.Number({
      minimum: 0,
      description:
        "Maximum seconds to wait. Omit to wait indefinitely; use 0 to poll once. Timing out leaves all pending runs active.",
    })),
  },
  { $id: "AgentWaitParams", additionalProperties: false },
);

export const AgentCloseParamsSchema = Type.Object(
  {
    agent_id: Type.String({ minLength: 1, description: "The owner-scoped handle of the identity to close permanently." }),
    delete_worktree: Type.Optional(Type.Boolean({
      description:
        "When true, remove the agent's clean, verified worktree while preserving its dedicated branch. Defaults to false.",
    })),
  },
  { $id: "AgentCloseParams", additionalProperties: false },
);
