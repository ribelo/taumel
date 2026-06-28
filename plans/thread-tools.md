---
kind: requirement
status: draft
tags: [thread-tools, search, tools]
depends_on: ["[[plans/capability-profile]]", "[[plans/tool-gateway]]"]
---
# Thread tools

## Intent

`find_thread` and `read_thread` help agents recover prior context across
sessions. Session search stays separate from transcript reading, relevance
scoring stays pure and testable, and Pi `SessionManager` access stays at the
adapter edge. The capability profile gates both tools, and neither depends on
goal internals or memory.

## Requirements

- **threads-tl01** (ubiquitous): The system shall provide the tools `find_thread` and `read_thread`.
- **threads-se01** (event-driven): When the model runs `find_thread`, the system shall search the current workspace before global sessions, matching by id, title, and content.
- **threads-rd01** (event-driven): When the model runs `read_thread`, the system shall accept an exact id or a unique prefix and may extract a goal-focused transcript with branch and compaction summaries where available.
- **threads-rd02** (unwanted): If a thread id is ambiguous, then the system shall return a clear result rather than guess.
- **threads-ar01** (ubiquitous): The system shall separate session catalog and search from transcript reading, keep relevance scoring pure and testable, keep Pi access at the adapter edge, and keep rendering separate from execution.
- **threads-gp01** (event-driven): When a thread tool is called, the system shall authorize it through the capability profile.
- **threads-dp01** (ubiquitous): The system shall keep thread tools free of dependencies on goal state and memory despite the `goal` parameter.
