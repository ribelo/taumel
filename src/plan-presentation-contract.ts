import Type from "typebox";

const PlanPresentationTaskSchema = Type.Object(
  {
    taskId: Type.String({ minLength: 1 }), title: Type.String({ minLength: 1 }),
    description: Type.Union([Type.String(), Type.Null()]),
    status: Type.Union([
      Type.Literal("pending"), Type.Literal("in_progress"),
      Type.Literal("completed"), Type.Literal("cancelled"),
    ]),
    depends_on: Type.Array(Type.String({ minLength: 1 })),
    origin: Type.Union([Type.Literal("user"), Type.Literal("agent")]),
  },
  { additionalProperties: false },
);
const PlanPresentationSchema = Type.Object(
  {
    planId: Type.String({ minLength: 1 }), sessionId: Type.String({ minLength: 1 }),
    status: Type.Union([
      Type.Literal("draft"), Type.Literal("active"), Type.Literal("paused"),
      Type.Literal("blocked"), Type.Literal("time_limited"), Type.Literal("complete"),
    ]),
    statusLabel: Type.String({ minLength: 1 }), tasks: Type.Array(PlanPresentationTaskSchema, { minItems: 1 }),
    completedTasks: Type.Integer({ minimum: 0 }), totalTasks: Type.Integer({ minimum: 1 }),
    tokensUsed: Type.Integer({ minimum: 0 }), timeUsedSeconds: Type.Integer({ minimum: 0 }),
    timeUsage: Type.String({ minLength: 1 }),
    timeLimitSeconds: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
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
  },
  { $id: "PlanPresentationDetails", additionalProperties: false },
);
