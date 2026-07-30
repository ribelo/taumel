import Type from "typebox";

const PlanBlockBaseSchema = {
  blockedAt: Type.Integer({ minimum: 0 }),
  reason: Type.String({ minLength: 1 }),
  source: Type.Union([Type.Literal("agent"), Type.Literal("system")]),
};

export const PlanBlockSchema = Type.Union([
  Type.Object(
    PlanBlockBaseSchema,
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PlanBlockBaseSchema,
      clearedAt: Type.Integer({ minimum: 0 }),
      clearedBy: Type.Union([Type.Literal("agent"), Type.Literal("user")]),
      resolution: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);

const PlanTaskBaseSchema = {
  taskId: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }),
  description: Type.Union([Type.String(), Type.Null()]),
  depends_on: Type.Array(Type.String({ minLength: 1 })),
  origin: Type.Union([Type.Literal("user"), Type.Literal("agent")]),
};

export const PlanTaskSchema = Type.Union([
  Type.Object(
    {
      ...PlanTaskBaseSchema,
      status: Type.Union([
        Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed"),
      ]),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...PlanTaskBaseSchema,
      status: Type.Literal("cancelled"),
      cancellationReason: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
]);
const PlanPresentationSchema = Type.Object(
  {
    planId: Type.String({ minLength: 1 }), sessionId: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal("draft"), Type.Literal("active"), Type.Literal("paused"),
      Type.Literal("blocked"), Type.Literal("time_limited"), Type.Literal("complete"),
    ]),
    statusLabel: Type.String({ minLength: 1 }), tasks: Type.Array(PlanTaskSchema, { minItems: 1 }),
    blocks: Type.Optional(Type.Array(PlanBlockSchema)),
    completedTasks: Type.Integer({ minimum: 0 }), totalTasks: Type.Integer({ minimum: 1 }),
    tokensUsed: Type.Integer({ minimum: 0 }), timeUsedSeconds: Type.Integer({ minimum: 0 }),
    timeUsage: Type.String({ minLength: 1 }),
    timeLimitSeconds: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
    extensionUnlocked: Type.Boolean(),
    createdAt: Type.Integer({ minimum: 0 }), updatedAt: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);
export const PlanPresentationDetailsSchema = Type.Object(
  {
    plan: Type.Union([PlanPresentationSchema, Type.Null()]),
    automation: Type.Object(
      {
        continuation: Type.Union([Type.Literal("enabled"), Type.Literal("interrupted")]),
        requiresUserInput: Type.Boolean(),
      },
      { additionalProperties: false },
    ),
    // Identities of tasks created by this call (^render-go01 create_task affected set).
    createdTaskIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  },
  { $id: "PlanPresentationDetails", additionalProperties: false },
);
