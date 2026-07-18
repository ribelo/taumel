---
kind: requirement
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

- The system shall maintain tool and skill visibility as session-effective state. Visibility changes shall not grant or revoke tool authorization. ^vis-sc01
- The system shall persist session-effective visibility in session custom entries and restore it when the same thread resumes. ^vis-sc02
- When decoding persisted session visibility, the system shall accept only schema version `1`. ^vis-c2wn
- When a new session starts and no session visibility state exists, the system shall seed session-effective visibility from global Pi config and trusted project Pi config according to the shared Taumel config precedence. ^vis-sc03
- The session-effective state shall take precedence over config defaults for the lifetime of that session. ^vis-sc04
- One visibility state shall apply across every conversation-tree branch in a thread/session. ^vis-sc05
- Visibility changes from managers or command forms shall apply immediately for the next model turn or skill-resolution pass. ^vis-sc06

### Config defaults

- Global and project Pi config files shall store visibility defaults as disabled lists only, preserving unrelated settings: ^vis-cf01

  ```json
  {
    "taumel": {
      "skills": { "disabled": ["grilling"] }
    }
  }
  ```

- The system shall resolve visibility defaults independently per category. A trusted project's category shall replace the corresponding global category. A category absent from trusted project config shall inherit the corresponding global category. ^vis-cf03
- The system shall read project visibility defaults only when `ctx.isProjectTrusted()` is true. ^vis-cf04
- When the user saves visibility to project config in an untrusted project, the system shall leave the file unchanged and warn that project trust is required. ^vis-cf05
- The system shall emit restore-time warnings for unavailable visibility names at most once per session per category. Each explicit manager or list invocation shall show its unavailable names. ^vis-cf07
- Project save shall write the current stored disabled set exactly, including unavailable names, and shall warn when unavailable names remain. ^vis-cf08
- Visibility save actions shall write trusted project Pi config and shall leave global Pi config unchanged. ^vis-cf09

### Tool visibility

- When a tool is disabled for the session, the system shall remove it from Pi's active tool list. ^vis-tl01
- Every registered Taumel tool shall be hideable. ^vis-tl03
- The system shall apply tool visibility through Pi's active tool list and shall keep tool registrations unchanged. ^vis-tl04
- `/tools disable <name>` and `/tools enable <name>` shall update session visibility, persist it to the session, and synchronize active tools immediately. ^vis-tl05
- `/tools save` shall save the current session-effective disabled tool list to trusted project config. ^vis-tl06
- `/tools list` shall list current session-effective tool visibility. In non-TUI modes, `/tools` with no arguments shall behave like `/tools list`. ^vis-tl07
- When `/tools enable <name>` or `/tools disable <name>` names a tool that is not currently registered, the system shall leave visibility unchanged and warn that the tool is unknown. ^vis-tl08
- When restored session or trusted project visibility references tools that are no longer registered, the system shall warn the user and retain those tool names in visibility state. ^vis-tl09

### Skill visibility

- When a skill is disabled for the session, the system shall omit it from `$...` autocomplete suggestions. ^vis-sk01
- When a prompt mentions a disabled skill with `$name`, the resolver shall ignore that mention without warning or error. ^vis-sk02
- Manually pasted `<skill ...>` blocks shall remain resolvable independently of skill visibility. ^vis-sk03
- `/skills disable <name>` and `/skills enable <name>` shall update session visibility and persist it to the session immediately. ^vis-sk04
- `/skills save` shall save the current session-effective disabled skill list to trusted project config. ^vis-sk05
- `/skills list` shall list discovered skills with current session-effective visibility. In non-TUI modes, `/skills` with no arguments shall behave like `/skills list`. ^vis-sk06
- When `/skills enable <name>` or `/skills disable <name>` names a skill that is not currently discovered, the system shall leave visibility unchanged and return a warning. ^vis-sk07
- When restoring session or trusted project skill visibility references skills that are no longer discovered, the system shall warn the user and keep the saved names untouched. ^vis-sk08



### Manager UI

- In TUI mode, `/tools` and `/skills` shall use Pi's `SettingsList` with its standard theme and built-in search, selection, scrolling, value presentation, hints, and list keybindings. ^vis-ui01
- Each manager shall show every item name and its current session-effective state as `enabled`, `disabled`, or `unavailable`. ^vis-ui02
- Pressing enter on a selected row shall toggle that row and apply the change immediately. ^vis-ui03
- Pressing `Ctrl+S` shall save the current session-effective disabled list to trusted project config. ^vis-ui04
- Manager help text shall identify Enter as toggle, `Ctrl+S` as save to project, and Escape as close. ^vis-ui05
- Managers shall show each unavailable disabled name as an explicit row with state `unavailable`. ^vis-ui06
- When the user toggles an unavailable row to enabled, the system shall remove that name from the session disabled set. ^vis-ui07
- Each available tool row shall show the tool's model-facing contract description. Each available skill row shall show the discovered skill description, falling back to its path. Each unavailable row shall show no description. ^vis-ui08
- Manager table layout, filtering, selection, scrolling, value styling, and list hints shall follow Pi's `SettingsList` behavior. ^vis-ui09

### Architecture limits

- The system shall apply tool visibility through Pi's active tool list and shall apply skill visibility through autocomplete and model-facing catalog filtering. ^vis-ar01
- Direct developer and test invocations of hidden tools and stale profile names shall receive their underlying invocation results without visibility-specific suppression. ^vis-ar02
- The system shall retain unknown names in session and project visibility state until the user removes them. ^vis-ar03
