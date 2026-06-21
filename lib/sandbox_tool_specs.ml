let string_array_schema =
  Tool_gateway.array_schema (Tool_gateway.string_schema ())

let exec_command_parameters =
  Tool_gateway.object_schema ~required:[ "cmd" ]
    [
      ("cmd", Tool_gateway.string_schema ~description:"Shell command to execute." ());
      ("workdir", Tool_gateway.string_schema ~description:"Working directory for the command." ());
      ("yield_time_ms", Tool_gateway.number_schema ~description:"How long to wait (in milliseconds) for output before yielding." ());
      ("max_output_tokens", Tool_gateway.number_schema ~description:"Maximum output token budget." ());
      ("tty", Tool_gateway.boolean_schema ~description:"Allocate a terminal session for interactive commands." ());
      ("shell", Tool_gateway.string_schema ~description:"Shell binary to launch." ());
      ("login", Tool_gateway.boolean_schema ~description:"Use shell login semantics." ());
      ( "sandbox_permissions",
        Tool_gateway.string_schema ~enum:[ "require_escalated" ]
          ~description:"Request approval to run outside the default sandbox." () );
      ("justification", Tool_gateway.string_schema ());
      ("prefix_rule", string_array_schema);
    ]

let write_stdin_parameters =
  Tool_gateway.object_schema ~required:[ "session_id" ]
    [
      ("session_id", Tool_gateway.number_schema ());
      ("chars", Tool_gateway.string_schema ());
      ("yield_time_ms", Tool_gateway.number_schema ());
      ("max_output_tokens", Tool_gateway.number_schema ());
    ]

let apply_patch_parameters =
  Tool_gateway.object_schema
    [
      ("input", Tool_gateway.string_schema ());
      ("patch", Tool_gateway.string_schema ());
    ]

let write_parameters =
  Tool_gateway.object_schema ~required:[ "path"; "content" ]
    [
      ( "path",
        Tool_gateway.string_schema
          ~description:"Path to the file to write (relative or absolute)" () );
      ( "content",
        Tool_gateway.string_schema ~description:"Content to write to the file" () );
    ]

let edit_replacement_parameters =
  Tool_gateway.object_schema
    ~required:[ "oldText"; "newText" ]
    ~additional_properties:false
    [
      ( "oldText",
        Tool_gateway.string_schema
          ~description:
            "Exact text for one targeted replacement. It must be unique in the original file and must not overlap with any other edits[].oldText in the same call."
          () );
      ( "newText",
        Tool_gateway.string_schema
          ~description:"Replacement text for this targeted edit." () );
    ]

let edit_parameters =
  Tool_gateway.object_schema ~required:[ "path"; "edits" ]
    ~additional_properties:false
    [
      ( "path",
        Tool_gateway.string_schema
          ~description:"Path to the file to edit (relative or absolute)" () );
      ( "edits",
        Tool_gateway.array_schema edit_replacement_parameters
          ~description:
            "One or more targeted replacements. Each edit is matched against the original file, not incrementally. Do not include overlapping or nested edits. If two changes touch the same block or nearby lines, merge them into one edit instead." );
    ]

let canonical_tool_specs =
  [
    {
      Tool_gateway.name = "exec_command";
      description =
        "Runs a command in a PTY, returning output or a session ID for ongoing interaction.";
      effect_kind = Tool_gateway.Execute;
      strict = false;
      parameters = exec_command_parameters;
    };
    {
      Tool_gateway.name = "write_stdin";
      description =
        "Writes characters to an existing unified exec session and returns recent output.";
      effect_kind = Tool_gateway.Execute;
      strict = false;
      parameters = write_stdin_parameters;
    };
    {
      Tool_gateway.name = "apply_patch";
      description =
        "Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.";
      effect_kind = Tool_gateway.Mutate;
      strict = false;
      parameters = apply_patch_parameters;
    };
    {
      Tool_gateway.name = "write";
      description =
        "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.";
      effect_kind = Tool_gateway.Mutate;
      strict = false;
      parameters = write_parameters;
    };
    {
      Tool_gateway.name = "edit";
      description =
        "Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge nearby changes into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.";
      effect_kind = Tool_gateway.Mutate;
      strict = false;
      parameters = edit_parameters;
    };
  ]
