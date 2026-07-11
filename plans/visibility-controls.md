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

- **vis-sc01** (ubiquitous): The system shall treat tool and skill visibility as session-effective state, not as a hard authorization policy.
- **vis-sc02** (ubiquitous): The system shall persist session-effective visibility in session custom entries and restore it when the same thread resumes.
- **vis-sc03** (event-driven): When a new session starts and no session visibility state exists, the system shall seed session-effective visibility from global Pi config and trusted project Pi config according to the shared Taumel config precedence.
- **vis-sc04** (ubiquitous): The session-effective state shall take precedence over config defaults for the lifetime of that session.
- **vis-sc05** (ubiquitous): Visibility shall apply to the whole thread/session, not to individual conversation-tree branches.
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

- **vis-cf03** (ubiquitous): The system shall resolve visibility defaults independently per category, so a trusted project `taumel.tools.disabled` replaces global `taumel.tools.disabled`, while missing project categories still inherit their global disabled lists.
- **vis-cf04** (event-driven): The system shall read project visibility defaults only when `ctx.isProjectTrusted()` is true.
- **vis-cf05** (event-driven): When the user saves visibility to project config in an untrusted project, the system shall leave the file unchanged and show a clear warning.
- **vis-cf07** (event-driven): Restore-time warnings for unavailable visibility names shall be emitted at most once per session per category, with managers/lists allowed to show the same warning again when explicitly opened.
- **vis-cf08** (event-driven): Project save shall write the current stored disabled set exactly, including unavailable names, and shall warn when unavailable names remain.
- **vis-cf09** (ubiquitous): Visibility save actions shall write only trusted project Pi config and shall not write global Pi config.

### Tool visibility

- **vis-tl01** (event-driven): When a tool is disabled for the session, the system shall remove it from Pi's active tool list so the model does not see or select it.
- **vis-tl03** (ubiquitous): The system shall keep implementation simple and define no protected/non-hideable tool list.
- **vis-tl04** (ubiquitous): Tool visibility shall not require dynamic unregistration from Pi; active-tool synchronization is the visibility mechanism.
- **vis-tl05** (event-driven): `/tools disable <name>` and `/tools enable <name>` shall update session visibility, persist it to the session, and synchronize active tools immediately.
- **vis-tl06** (event-driven): `/tools save` shall save the current session-effective disabled tool list to trusted project config.
- **vis-tl07** (event-driven): `/tools list` shall list current session-effective tool visibility. In non-TUI modes, `/tools` with no arguments shall behave like `/tools list`.
- **vis-tl08** (event-driven): When `/tools enable <name>` or `/tools disable <name>` names a tool that is not currently registered, the system shall leave visibility unchanged and return a warning instead of silently storing the unknown name.
- **vis-tl09** (event-driven): When restoring session or trusted project tool visibility references tools that are no longer registered, the system shall warn the user rather than silently swallowing the mismatch.

### Skill visibility

- **vis-sk01** (event-driven): When a skill is disabled for the session, the system shall omit it from `$...` autocomplete suggestions.
- **vis-sk02** (event-driven): When a prompt mentions a disabled skill with `$name`, the resolver shall ignore that mention without warning or error.
- **vis-sk03** (ubiquitous): Skill visibility shall not try to block manually pasted `<skill ...>` blocks.
- **vis-sk04** (event-driven): `/skills disable <name>` and `/skills enable <name>` shall update session visibility and persist it to the session immediately.
- **vis-sk05** (event-driven): `/skills save` shall save the current session-effective disabled skill list to trusted project config.
- **vis-sk06** (event-driven): `/skills list` shall list discovered skills with current session-effective visibility. In non-TUI modes, `/skills` with no arguments shall behave like `/skills list`.
- **vis-sk07** (event-driven): When `/skills enable <name>` or `/skills disable <name>` names a skill that is not currently discovered, the system shall leave visibility unchanged and return a warning.
- **vis-sk08** (event-driven): When restoring session or trusted project skill visibility references skills that are no longer discovered, the system shall warn the user and keep the saved names untouched.



### Manager UI

- **vis-ui02** (ubiquitous): Each manager shall show the current session-effective state only: `enabled` or `disabled`, plus the item name and a short description or path where useful.
- **vis-ui03** (event-driven): Pressing enter on a selected row shall toggle that row and apply the change immediately.
- **vis-ui04** (event-driven): Pressing `Ctrl+S` shall save the current session-effective disabled list to trusted project config.
- **vis-ui05** (ubiquitous): Manager help text shall include `enter toggle • ctrl+s save to project • esc close` or equivalent concise wording.
- **vis-ui06** (ubiquitous): Managers shall show unavailable disabled names as explicit rows, marked `unavailable`, so the user can see stale config instead of it being hidden.
- **vis-ui07** (event-driven): Toggling an unavailable disabled row to enabled shall explicitly remove that name from the session disabled set because the user selected that cleanup action.

### Architecture limits

- **vis-ar01** (ubiquitous): The system shall avoid fighting Pi extension API limits; hiding through active tools, autocomplete filtering, and model-facing catalog filtering is sufficient.
- **vis-ar02** (ubiquitous): Direct developer/test invocation of a hidden tool or stale profile name is outside the normal UX contract and need not be made silent.
- **vis-ar03** (ubiquitous): The system shall not silently delete unknown names from session or project visibility state; the user owns cleanup.
