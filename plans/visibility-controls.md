---
kind: requirement
status: draft
---
# Visibility controls

## Intent

Visibility controls let the user decide which Taumel tools, skills, and agent
profiles are exposed in a session. They are a UX preference, not a security
boundary: disabled items should disappear from the model-facing surface instead
of producing noisy "disabled by user" errors during normal use.

The current session has precedence. Global Pi config may provide personal
default disabled lists in `~/.pi/agent/settings.json`, and a trusted project may
provide project defaults in `<cwd>/.pi/settings.json`. A session starts from
those defaults when it has no saved session visibility state. Session changes
apply immediately, persist with the thread, and can be saved back to project
config with `Ctrl+S` or a command-form `save` action.

## Requirements

### Scope and precedence

- **vis-sc01** (ubiquitous): The system shall maintain tool and skill visibility as session-effective state. Visibility changes shall not grant or revoke tool authorization.
- **vis-sc02** (ubiquitous): The system shall persist session-effective visibility in session custom entries and restore it when the same thread resumes.
- **vis-sc03** (event-driven): When a new session starts and no session visibility state exists, the system shall seed session-effective visibility from global Pi config and trusted project Pi config according to the shared Taumel config precedence.
- **vis-sc04** (ubiquitous): The session-effective state shall take precedence over config defaults for the lifetime of that session.
- **vis-sc05** (ubiquitous): One visibility state shall apply across every conversation-tree branch in a thread/session.
- **vis-sc06** (event-driven): Visibility changes from managers or command forms shall apply immediately for the next model turn or skill-resolution pass.

### Config defaults

- **vis-cf01** (ubiquitous): Global and project Pi config files shall store visibility defaults as disabled lists only, preserving unrelated settings:

  ```json
  {
    "taumel": {
      "skills": { "disabled": ["grilling"] }
    }
  }
  ```

- **vis-cf03** (ubiquitous): The system shall resolve visibility defaults independently per category. A trusted project's category shall replace the corresponding global category. A category absent from trusted project config shall inherit the corresponding global category.
- **vis-cf04** (event-driven): The system shall read project visibility defaults only when `ctx.isProjectTrusted()` is true.
- **vis-cf05** (event-driven): When the user saves visibility to project config in an untrusted project, the system shall leave the file unchanged and warn that project trust is required.
- **vis-cf07** (event-driven): The system shall emit restore-time warnings for unavailable visibility names at most once per session per category. Each explicit manager or list invocation shall show its unavailable names.
- **vis-cf08** (event-driven): Project save shall write the current stored disabled set exactly, including unavailable names, and shall warn when unavailable names remain.
- **vis-cf09** (ubiquitous): Visibility save actions shall write trusted project Pi config and shall leave global Pi config unchanged.

### Tool visibility

- **vis-tl01** (event-driven): When a tool is disabled for the session, the system shall remove it from Pi's active tool list.
- **vis-tl03** (ubiquitous): Every registered Taumel tool shall be hideable.
- **vis-tl04** (ubiquitous): The system shall apply tool visibility through Pi's active tool list and shall keep tool registrations unchanged.
- **vis-tl05** (event-driven): `/tools disable <name>` and `/tools enable <name>` shall update session visibility, persist it to the session, and synchronize active tools immediately.
- **vis-tl06** (event-driven): `/tools save` shall save the current session-effective disabled tool list to trusted project config.
- **vis-tl07** (event-driven): `/tools list` shall list current session-effective tool visibility. In non-TUI modes, `/tools` with no arguments shall behave like `/tools list`.
- **vis-tl08** (event-driven): When `/tools enable <name>` or `/tools disable <name>` names a tool that is not currently registered, the system shall leave visibility unchanged and warn that the tool is unknown.
- **vis-tl09** (event-driven): When restored session or trusted project visibility references tools that are no longer registered, the system shall warn the user and retain those tool names in visibility state.

### Skill visibility

- **vis-sk01** (event-driven): When a skill is disabled for the session, the system shall omit it from `$...` autocomplete suggestions.
- **vis-sk02** (event-driven): When a prompt mentions a disabled skill with `$name`, the resolver shall ignore that mention without warning or error.
- **vis-sk03** (ubiquitous): Manually pasted `<skill ...>` blocks shall remain resolvable independently of skill visibility.
- **vis-sk04** (event-driven): `/skills disable <name>` and `/skills enable <name>` shall update session visibility and persist it to the session immediately.
- **vis-sk05** (event-driven): `/skills save` shall save the current session-effective disabled skill list to trusted project config.
- **vis-sk06** (event-driven): `/skills list` shall list discovered skills with current session-effective visibility. In non-TUI modes, `/skills` with no arguments shall behave like `/skills list`.
- **vis-sk07** (event-driven): When `/skills enable <name>` or `/skills disable <name>` names a skill that is not currently discovered, the system shall leave visibility unchanged and return a warning.
- **vis-sk08** (event-driven): When restoring session or trusted project skill visibility references skills that are no longer discovered, the system shall warn the user and keep the saved names untouched.



### Manager UI

- **vis-ui01** (ubiquitous): In TUI mode, `/tools` and `/skills` shall use Pi's `SettingsList` with its standard theme and built-in search, selection, scrolling, value presentation, hints, and list keybindings.
- **vis-ui02** (ubiquitous): Each manager shall show every item name and its current session-effective state as `enabled`, `disabled`, or `unavailable`.
- **vis-ui03** (event-driven): Pressing enter on a selected row shall toggle that row and apply the change immediately.
- **vis-ui04** (event-driven): Pressing `Ctrl+S` shall save the current session-effective disabled list to trusted project config.
- **vis-ui05** (ubiquitous): Manager help text shall identify Enter as toggle, `Ctrl+S` as save to project, and Escape as close.
- **vis-ui06** (ubiquitous): Managers shall show each unavailable disabled name as an explicit row with state `unavailable`.
- **vis-ui07** (event-driven): When the user toggles an unavailable row to enabled, the system shall remove that name from the session disabled set.
- **vis-ui08** (ubiquitous): Each available tool row shall show the tool's model-facing contract description. Each available skill row shall show the discovered skill description, falling back to its path. Each unavailable row shall show no description.
- **vis-ui09** (ubiquitous): Manager table layout, filtering, selection, scrolling, value styling, and list hints shall follow Pi's `SettingsList` behavior.

### Architecture limits

- **vis-ar01** (ubiquitous): The system shall apply tool visibility through Pi's active tool list and shall apply skill visibility through autocomplete and model-facing catalog filtering.
- **vis-ar02** (ubiquitous): Direct developer and test invocations of hidden tools and stale profile names shall receive their underlying invocation results without visibility-specific suppression.
- **vis-ar03** (ubiquitous): The system shall retain unknown names in session and project visibility state until the user removes them.
