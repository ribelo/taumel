let canonical_tool_specs =
  [
    { Tool_gateway.name = "exec_command"; effect_kind = Tool_gateway.Execute };
    { Tool_gateway.name = "write_stdin"; effect_kind = Tool_gateway.Execute };
    { Tool_gateway.name = "apply_patch"; effect_kind = Tool_gateway.Mutate };
    { Tool_gateway.name = "write"; effect_kind = Tool_gateway.Mutate };
    { Tool_gateway.name = "edit"; effect_kind = Tool_gateway.Mutate };
    { Tool_gateway.name = "read"; effect_kind = Tool_gateway.Pure };
  ]
