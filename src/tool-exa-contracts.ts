import Type from "typebox";

const stringArray = Type.Array(Type.String());

export const ExaSearchTypeSchema = Type.Union(
  [
    Type.Literal("instant"),
    Type.Literal("fast"),
    Type.Literal("auto"),
    Type.Literal("deep-lite"),
    Type.Literal("deep"),
    Type.Literal("deep-reasoning"),
  ],
  { description: "Search mode controlling latency and depth. Omit to let Exa choose." },
);

export const ExaComplianceSchema = Type.Literal("hipaa", {
  description: "Compliance mode; currently only hipaa.",
});

export const ExaTextOptionsSchema = Type.Object(
  {
    maxCharacters: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Maximum page-text characters to return.",
      }),
    ),
  },
  { $id: "ExaTextOptions", additionalProperties: false },
);

export const ExaHighlightsOptionsSchema = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        minLength: 1,
        description:
          "Query used to select relevant highlights; defaults to the surrounding search query when available.",
      }),
    ),
    maxCharacters: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Maximum total highlight characters to return.",
      }),
    ),
  },
  { $id: "ExaHighlightsOptions", additionalProperties: false },
);

export const ExaSummaryOptionsSchema = Type.Object(
  {
    query: Type.Optional(
      Type.String({
        minLength: 1,
        description: "Question or focus for the generated summary.",
      }),
    ),
  },
  {
    $id: "ExaSummaryOptions",
    additionalProperties: false,
    description: "Request a generated summary for each result.",
  },
);

export const ExaContentOptionsSchema = Type.Object(
  {
    text: Type.Optional(
      Type.Union([Type.Boolean(), ExaTextOptionsSchema], {
        description: "Whether to return page text. Use an options object to limit returned characters.",
      }),
    ),
    highlights: Type.Optional(
      Type.Union([Type.Boolean(), ExaHighlightsOptionsSchema], {
        description:
          "Whether to return relevant page excerpts. Use an options object to control excerpt selection.",
      }),
    ),
    summary: Type.Optional(ExaSummaryOptionsSchema),
    maxAgeHours: Type.Optional(
      Type.Integer({
        minimum: -1,
        maximum: 720,
        description:
          "Maximum cached-content age in hours: positive values accept cache younger than the limit, 0 fetches fresh content, -1 uses cache only, and omission uses fallback fetching.",
      }),
    ),
    subpages: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 100,
        description: "Number of linked subpages to crawl per result. Defaults to 0; accepts 0–100.",
      }),
    ),
    subpageTarget: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 100 }), stringArray], {
        description: "Keyword or keywords used to prioritize which subpages to crawl.",
      }),
    ),
  },
  {
    $id: "ExaContentOptions",
    additionalProperties: false,
    description: "Content extraction to include with each search result.",
  },
);

export const WebSearchExaParamsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      maxLength: 2000,
      description:
        "Search query or question. Be specific about the desired facts, entities, sources, or time range. Maximum 2,000 characters.",
    }),
    type: Type.Optional(ExaSearchTypeSchema),
    includeDomains: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        maxItems: 1200,
        description: "Domains allowed in results; when set, results come only from these domains.",
      }),
    ),
    excludeDomains: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        maxItems: 1200,
        description: "Domains excluded from results.",
      }),
    ),
    startPublishedDate: Type.Optional(
      Type.String({ description: "Return pages published after this ISO 8601 timestamp." }),
    ),
    endPublishedDate: Type.Optional(
      Type.String({ description: "Return pages published before this ISO 8601 timestamp." }),
    ),
    numResults: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: "Number of results to return. Defaults to 10; accepts 1–100, with lower limits for some search modes.",
      }),
    ),
    moderation: Type.Optional(
      Type.Boolean({ description: "Whether to filter unsafe content. Defaults to false." }),
    ),
    contents: Type.Optional(ExaContentOptionsSchema),
    additionalQueries: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), {
        minItems: 1,
        maxItems: 10,
        description: "Additional query variants for deep search. Accepts 1–10.",
      }),
    ),
    category: Type.Optional(
      Type.String({ minLength: 1, description: "Optional Exa result-category filter." }),
    ),
    userLocation: Type.Optional(
      Type.String({ minLength: 2, maxLength: 2, description: "Two-letter country code for location-aware search." }),
    ),
    compliance: Type.Optional(ExaComplianceSchema),
    systemPrompt: Type.Optional(
      Type.String({ minLength: 1, description: "Additional instructions controlling deep-search behavior." }),
    ),
  },
  { $id: "WebSearchExaParams", additionalProperties: false },
);

export const CrawlingExaParamsSchema = Type.Object(
  {
    ids: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
        minItems: 1,
        maxItems: 100,
        description: "Exa document IDs to fetch. Accepts 1–100.",
      }),
    ),
    urls: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 2048 }), {
        minItems: 1,
        maxItems: 100,
        description: "Page URLs to fetch. Accepts 1–100.",
      }),
    ),
    compliance: Type.Optional(ExaComplianceSchema),
    text: Type.Optional(
      Type.Union([Type.Boolean(), ExaTextOptionsSchema], {
        description: "Whether to return page text. Use an options object to limit returned characters.",
      }),
    ),
    highlights: Type.Optional(
      Type.Union([Type.Boolean(), ExaHighlightsOptionsSchema], {
        description:
          "Whether to return relevant page excerpts. Use an options object to control excerpt selection.",
      }),
    ),
    summary: Type.Optional(ExaSummaryOptionsSchema),
    maxAgeHours: Type.Optional(
      Type.Integer({
        minimum: -1,
        maximum: 720,
        description:
          "Maximum cached-content age in hours: positive values accept cache younger than the limit, 0 fetches fresh content, -1 uses cache only, and omission uses fallback fetching.",
      }),
    ),
    subpages: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 100,
        description: "Number of linked subpages to crawl per result. Defaults to 0; accepts 0–100.",
      }),
    ),
    subpageTarget: Type.Optional(
      Type.Union([Type.String({ minLength: 1, maxLength: 100 }), stringArray], {
        description: "Keyword or keywords used to prioritize which subpages to crawl.",
      }),
    ),
  },
  { $id: "CrawlingExaParams", additionalProperties: false },
);

export const GetCodeContextExaParamsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      maxLength: 2000,
      description:
        "Code or API question to research. Include relevant language, framework, library, symbols, and desired examples. Maximum 2,000 characters.",
    }),
    tokensNum: Type.Optional(
      Type.Union(
        [
          Type.Literal("dynamic"),
          Type.Integer({ minimum: 50, maximum: 100000 }),
        ],
        {
          description: "Approximate output-token budget, or dynamic to let Exa choose. Accepts 50–100,000.",
        },
      ),
    ),
  },
  { $id: "GetCodeContextExaParams", additionalProperties: false },
);

export const ExaAgentCreateRunParamsSchema = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description:
        "Research or extraction task for the Exa Agent. State the desired outcome, scope, source expectations, and completion criteria.",
    }),
    systemPrompt: Type.Optional(
      Type.String({ minLength: 1, description: "Optional additional instructions governing the research run." }),
    ),
    input: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), { description: "Optional structured JSON input for the run." }),
    ),
    outputSchema: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description: "Optional JSON Schema constraining the run's structured output.",
      }),
    ),
    effort: Type.Optional(
      Type.Union(
        [
          Type.Literal("minimal"),
          Type.Literal("low"),
          Type.Literal("medium"),
          Type.Literal("high"),
          Type.Literal("xhigh"),
          Type.Literal("auto"),
        ],
        { description: "Research effort tier. Prefer low or medium unless deep research is explicitly needed." },
      ),
    ),
    previousRunId: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: "^[A-Za-z0-9_.:-]+$",
        description: "Optional prior Exa Agent run ID to continue or refine.",
      }),
    ),
    metadata: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), { description: "Optional JSON metadata to attach to the run." }),
    ),
  },
  { $id: "ExaAgentCreateRunParams", additionalProperties: false },
);

export const ExaAgentRunIdParamsSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^[A-Za-z0-9_.:-]+$",
      description: "Exa Agent run ID returned by exa_agent_create_run or exa_agent_list_runs.",
    }),
  },
  { $id: "ExaAgentRunIdParams", additionalProperties: false },
);

export const ExaAgentListRunsParamsSchema = Type.Object(
  {
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: "Maximum runs to return. Accepts 1–100.",
      }),
    ),
    cursor: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 200,
        pattern: "^[A-Za-z0-9_.:-]+$",
        description: "Opaque cursor returned by a previous run-list response.",
      }),
    ),
  },
  { $id: "ExaAgentListRunsParams", additionalProperties: false },
);

export const ExaAgentListEventsParamsSchema = Type.Object(
  {
    id: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: "^[A-Za-z0-9_.:-]+$",
      description: "Exa Agent run ID whose events to list.",
    }),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 100,
        description: "Maximum events to return. Accepts 1–100.",
      }),
    ),
    cursor: Type.Optional(
      Type.String({ minLength: 1, description: "Opaque cursor returned by a previous event-list response." }),
    ),
    lastEventId: Type.Optional(
      Type.String({ minLength: 1, description: "Return events after this event ID for incremental reading." }),
    ),
  },
  { $id: "ExaAgentListEventsParams", additionalProperties: false },
);
