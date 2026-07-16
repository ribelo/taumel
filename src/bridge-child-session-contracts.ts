import Type, { type Static } from "typebox";

const SharedWorkspaceBindingSchema = Type.Object(
  { variant: Type.Literal("shared"), source_root: Type.String({ minLength: 1 }) },
  { $id: "SharedWorkspaceBinding", additionalProperties: false },
);
const WorktreeWorkspaceBindingSchema = Type.Object(
  {
    variant: Type.Literal("worktree"),
    source_origin: Type.String({ minLength: 1 }),
    main_repository_root: Type.String({ minLength: 1 }),
    main_repository_id: Type.String({ minLength: 1 }),
  },
  { $id: "WorktreeWorkspaceBinding", additionalProperties: false },
);
const ChildAgentMetadataFields = {
  kind: Type.Literal("agent"),
  agentKind: Type.Union([Type.Literal("generic"), Type.Literal("finder"), Type.Literal("oracle")]),
  agentId: Type.String({ minLength: 1 }),
  modelId: Type.String({ minLength: 1 }),
  thinkingLevel: Type.String({ minLength: 1 }),
  activeTools: Type.Array(Type.String({ minLength: 1 })),
  capabilityProfile: Type.Unknown(),
  networkMode: Type.Union([Type.Literal("disabled"), Type.Literal("enabled")]),
  isolated_child: Type.Literal(true),
  workspaceDirectory: Type.String({ minLength: 1 }),
  sourceWorkspace: Type.String({ minLength: 1 }),
  childSessionFile: Type.Optional(Type.String({ minLength: 1 })),
};
const SharedAgentSessionMetadataSchema = Type.Object(
  {
    ...ChildAgentMetadataFields,
    isolation: Type.Literal("none"),
    workspaceBinding: SharedWorkspaceBindingSchema,
  },
  { $id: "SharedAgentSessionMetadata", additionalProperties: false },
);
const WorktreeAgentSessionMetadataSchema = Type.Object(
  {
    ...ChildAgentMetadataFields,
    isolation: Type.Literal("worktree"),
    workspaceBinding: WorktreeWorkspaceBindingSchema,
    worktreePath: Type.String({ minLength: 1 }),
    worktreeBranch: Type.String({ minLength: 1 }),
    mainRepositoryRoot: Type.String({ minLength: 1 }),
  },
  { $id: "WorktreeAgentSessionMetadata", additionalProperties: false },
);
const RalphSessionMetadataSchema = Type.Object(
  {
    kind: Type.Literal("ralph"), objective: Type.String({ minLength: 1 }),
    controllerSessionId: Type.String({ minLength: 1 }),
    maxIterations: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    reflectionEvery: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    activeTools: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
    capabilityProfile: Type.Optional(Type.Unknown()),
  },
  { $id: "RalphSessionMetadata", additionalProperties: false },
);
export const ChildSessionMetadataSchema = Type.Union(
  [RalphSessionMetadataSchema, SharedAgentSessionMetadataSchema, WorktreeAgentSessionMetadataSchema],
  { $id: "ChildSessionMetadata" },
);
export type ChildSessionMetadata = Static<typeof ChildSessionMetadataSchema>;

