open Jsoo_bridge
open App_state

let js_require name =
  let req = Unsafe.js_expr "(typeof require === 'function' ? require : globalThis.require)" in
  Unsafe.fun_call req [| js_string name |]

let direct_string_field obj name =
  match string_value (Unsafe.get obj name) with Some value -> value | None -> ""

let direct_int_field obj name default =
  match float_value (Unsafe.get obj name) with
  | Some value -> int_of_float value
  | None -> default

let shell_operator word = List.mem word [ "&&"; "||"; ";"; "|" ]

let fallback_reflect_words script =
  let words =
    script
    |> String.split_on_char ' '
    |> List.concat_map (fun part ->
           let rec split_semi value =
             match String.index_opt value ';' with
             | None -> [ value ]
             | Some index ->
                 let before = String.sub value 0 index in
                 let after = String.sub value (index + 1) (String.length value - index - 1) in
                 before :: ";" :: split_semi after
           in
           split_semi part)
    |> List.filter (fun part -> String.trim part <> "")
  in
  let rec commands current acc = function
    | [] -> List.rev (if current = [] then acc else List.rev current :: acc)
    | word :: rest when shell_operator word ->
        commands [] (if current = [] then acc else List.rev current :: acc) rest
    | word :: rest -> commands (word :: current) acc rest
  in
  let command_node words =
    let children =
      words
      |> List.mapi (fun index word ->
             if index = 0 then
               Taumel.Exec_policy.{
                 kind = "command_name";
                 text = word;
                 children = [ { kind = "word"; text = word; children = [] } ];
               }
             else Taumel.Exec_policy.{ kind = "word"; text = word; children = [] })
    in
    Taumel.Exec_policy.{ kind = "command"; text = String.concat " " words; children }
  in
  Ok
    Taumel.Exec_policy.{
      kind = "program";
      text = script;
      children = List.map command_node (commands [] [] words);
    }

let reflect_bash_script script =
  try
    let parser_ctor = js_require "tree-sitter" in
    let bash = js_require "tree-sitter-bash" in
    let parser = Unsafe.new_obj parser_ctor [||] in
    ignore (Unsafe.meth_call parser "setLanguage" [| bash |]);
    let tree = Unsafe.meth_call parser "parse" [| js_string script |] in
    let root = Unsafe.get tree "rootNode" in
    let rec reflect node =
      let child_count = direct_int_field node "childCount" 0 in
      let children =
        List.init child_count (fun index ->
            reflect
              (Unsafe.meth_call node "child" [| js_number (float_of_int index) |]))
      in
      ({
         Taumel.Exec_policy.kind = direct_string_field node "type";
         text = direct_string_field node "text";
         children;
       }
        : Taumel.Exec_policy.node)
    in
    Ok (reflect root)
  with _ -> fallback_reflect_words script

let unmatched_context (sandbox : Taumel.Sandbox.config) sandbox_permissions =
  let requests_sandbox_override =
    match sandbox_permissions with
    | Taumel.Sandbox.Require_escalated _ -> true
    | Taumel.Sandbox.Use_default -> false
  in
  {
    Taumel.Exec_policy.approval_never = sandbox.approval_policy = Taumel.Sandbox.Never;
    approval_prompts_available = sandbox.approval_policy <> Taumel.Sandbox.Never;
    sandbox_restricted = sandbox.filesystem_mode <> Taumel.Sandbox.Danger_full_access;
    sandbox_disabled = sandbox.no_sandbox || sandbox.filesystem_mode = Taumel.Sandbox.Danger_full_access;
    requests_sandbox_override;
  }

let policy_decision_for_command sandbox sandbox_permissions cmd =
  match reflect_bash_script cmd with
  | Error _ -> Some Taumel.Exec_policy.Prompt
  | Ok ast ->
      let check = Taumel.Exec_policy.decide_ast !exec_policy ast in
      (match Taumel.Exec_policy.override_decision check with
      | Some decision -> Some decision
      | None ->
          let fallback =
            Taumel.Exec_policy.decide_ast_with_fallback !exec_policy
              (unmatched_context sandbox sandbox_permissions)
              ast
          in
          if fallback.decision = Taumel.Exec_policy.Allow then None
          else Some fallback.decision)

let policy_reason_for_command sandbox sandbox_permissions cmd =
  match reflect_bash_script cmd with
  | Error _ -> Some "exec policy requires approval: unsupported shell syntax"
  | Ok ast ->
      let check = Taumel.Exec_policy.decide_ast !exec_policy ast in
      let candidates =
        check.matched_rules
        |> List.filter (fun (rule : Taumel.Exec_policy.matched_rule) ->
               rule.decision = Taumel.Exec_policy.Prompt
               || rule.decision = Taumel.Exec_policy.Forbidden)
      in
      let pattern_len (rule : Taumel.Exec_policy.matched_rule) = List.length rule.pattern in
      match List.sort (fun left right -> compare (pattern_len right) (pattern_len left)) candidates with
      | rule :: _ ->
          Some
            (match rule.justification with
            | Some text when String.trim text <> "" ->
                "exec policy requires approval: " ^ text
            | _ -> "exec policy requires approval by policy")
      | [] when check.defaulted_to_prompt -> Some "exec policy requires approval: validation error fallback"
      | [] ->
          let fallback =
            Taumel.Exec_policy.decide_ast_with_fallback !exec_policy
              (unmatched_context sandbox sandbox_permissions)
              ast
          in
          let outside_safe_subset =
            match Taumel.Exec_policy.command_tokens_from_ast ast with
            | Error _ -> true
            | Ok _ -> false
          in
          (match fallback.decision with
          | Taumel.Exec_policy.Prompt when outside_safe_subset ->
              Some "exec policy requires approval: unsupported shell construct"
          | Taumel.Exec_policy.Prompt ->
              Some "exec policy requires approval: dangerous command"
          | Taumel.Exec_policy.Forbidden ->
              Some "exec policy forbids this command by policy"
          | Taumel.Exec_policy.Allow -> None)

let allow_amendment_tokens cmd =
  match reflect_bash_script cmd with
  | Error _ -> None
  | Ok ast -> (
      match Taumel.Exec_policy.command_tokens_from_ast ast with
      | Ok (_ :: _ as tokens) -> Some tokens
      | Ok [] | Error _ -> None)

let explicit_prompt_or_forbidden cmd =
  match reflect_bash_script cmd with
  | Error _ -> true
  | Ok ast ->
      let check = Taumel.Exec_policy.decide_ast !exec_policy ast in
      List.exists
        (fun (rule : Taumel.Exec_policy.matched_rule) ->
          rule.decision = Taumel.Exec_policy.Prompt
          || rule.decision = Taumel.Exec_policy.Forbidden)
        check.matched_rules

let append_allow_rule tokens =
  let raw_rule =
    Taumel.Exec_policy.{
      raw_id = None;
      raw_pattern = List.map (fun token -> One token) tokens;
      raw_decision = Allow;
      raw_justification = Some "approved from exec policy prompt";
      raw_match_examples = [ Tokens tokens ];
      raw_not_match_examples = [];
    }
  in
  let existing = !exec_policy in
  let appended = Taumel.Exec_policy.compile [ ("global", [ raw_rule ]) ] in
  exec_policy :=
    {
      rules = existing.rules @ appended.rules;
      scopes = List.sort_uniq String.compare (existing.scopes @ [ "global" ]);
      errors = existing.errors @ appended.errors;
    };
  ok_obj [ ("activeRuleCount", js_number (float_of_int (Taumel.Exec_policy.active_rule_count !exec_policy))) ]

let js_decision decision = js_string (Taumel.Exec_policy.decision_to_string decision)

let js_matched_rule (rule : Taumel.Exec_policy.matched_rule) =
  Unsafe.obj
    [|
      ("id", js_string rule.id);
      ("scope", js_string rule.scope);
      ("decision", js_decision rule.decision);
      ("pattern", js_string (Taumel.Exec_policy.string_of_pattern rule.pattern));
      ("justification", js_string (Option.value rule.justification ~default:""));
    |]

let check_command cmd =
  match reflect_bash_script cmd with
  | Error message ->
      Taumel.Exec_policy.{ decision = Prompt; matched_rules = []; tokens = []; defaulted_to_prompt = false }, Some message
  | Ok ast -> (Taumel.Exec_policy.decide_ast !exec_policy ast, None)

let summary_result () =
  let scopes = Taumel.Exec_policy.contributing_scopes !exec_policy in
  let text =
    Printf.sprintf "Exec policy: %d active rule(s). Contributing scopes: %s"
      (Taumel.Exec_policy.active_rule_count !exec_policy)
      (if scopes = [] then "none" else String.concat ", " scopes)
  in
  command_result_obj ~ok:true ~message:text
    ~details:
      (Unsafe.obj
         [|
           ("ok", js_bool true);
           ("activeRuleCount", js_number (float_of_int (Taumel.Exec_policy.active_rule_count !exec_policy)));
           ("scopes", js_array (List.map js_string scopes));
         |])

let check_result cmd =
  let check, parse_error = check_command cmd in
  let text =
    let matched =
      match check.matched_rules with
      | [] -> "none"
      | rules -> rules |> List.map (fun (rule : Taumel.Exec_policy.matched_rule) -> rule.scope ^ ":" ^ rule.id) |> String.concat ", "
    in
    Printf.sprintf "Exec policy decision: %s\nMatched rules: %s"
      (Taumel.Exec_policy.decision_to_string check.decision)
      matched
  in
  command_result_obj ~ok:true ~message:text
    ~details:
      (Unsafe.obj
         [|
           ("ok", js_bool true);
           ("decision", js_decision check.decision);
           ("matchedRules", js_array (List.map js_matched_rule check.matched_rules));
           ("tokens", js_array (List.map js_string check.tokens));
           ("defaultedToPrompt", js_bool check.defaulted_to_prompt);
           ("parseError", js_string (Option.value parse_error ~default:""));
         |])

let handle_command args =
  let args = String.trim args in
  if args = "" then summary_result ()
  else
    let prefix = "check " in
    if String.length args >= String.length prefix
       && String.sub args 0 (String.length prefix) = prefix
    then
      let cmd = String.sub args (String.length prefix) (String.length args - String.length prefix) in
      check_result cmd
    else error_obj "Usage: /execpolicy [check <command>]"

let token_from_js value =
  if is_js_string value then
    match string_value value with Some value -> Ok (Taumel.Exec_policy.One value) | None -> Error "invalid token"
  else if is_js_array value then
    let values = array_items value |> List.filter_map string_value in
    if values = [] then Error "token alternatives must not be empty"
    else Ok (Taumel.Exec_policy.Alternatives values)
  else Error "pattern tokens must be strings or string arrays"

let example_from_js value =
  if is_js_string value then
    match string_value value with Some value -> Ok (Taumel.Exec_policy.Script value) | None -> Error "invalid example"
  else if is_js_array value then
    let values = array_items value |> List.filter_map string_value in
    if List.length values = List.length (array_items value) then Ok (Taumel.Exec_policy.Tokens values)
    else Error "example token arrays must contain only strings"
  else Error "examples must be strings or string arrays"

let parse_array field parse obj =
  match object_field obj field with
  | None -> Ok []
  | Some value when is_js_array value ->
      let rec loop acc = function
        | [] -> Ok (List.rev acc)
        | item :: rest -> (
            match parse item with
            | Ok value -> loop (value :: acc) rest
            | Error _ as error -> error)
      in
      loop [] (array_items value)
  | Some _ -> Error (field ^ " must be an array")

let raw_rule_from_js obj =
  if not (is_js_object obj) then Error "rule must be an object"
  else
    match parse_array "pattern" token_from_js obj with
    | Error _ as error -> error
    | Ok [] -> Error "rule pattern must not be empty"
    | Ok raw_pattern ->
        let decision =
          match Taumel.Exec_policy.decision_of_string (get_string obj "decision") with
          | Some decision -> decision
          | None -> Taumel.Exec_policy.Allow
        in
        let match_field = if has_property obj "notMatch" then "notMatch" else "not_match" in
        match (parse_array "match" example_from_js obj, parse_array match_field example_from_js obj) with
        | Ok raw_match_examples, Ok raw_not_match_examples ->
            Ok
              Taumel.Exec_policy.{
                raw_id = optional_string_field obj "id";
                raw_pattern;
                raw_decision = decision;
                raw_justification = optional_string_field obj "justification";
                raw_match_examples;
                raw_not_match_examples;
              }
        | Error message, _ | _, Error message -> Error message

let scope_rules_from_js obj =
  if not (is_js_object obj) then Error "execPolicy must be an object"
  else
    match object_field obj "rules" with
    | None -> Ok []
    | Some rules when is_js_array rules ->
        let rec loop acc = function
          | [] -> Ok (List.rev acc)
          | item :: rest -> (
              match raw_rule_from_js item with
              | Ok rule -> loop (rule :: acc) rest
              | Error _ as error -> error)
        in
        loop [] (array_items rules)
    | Some _ -> Error "execPolicy.rules must be an array"

let compile_settings settings =
  let scopes, scope_errors =
    get_object_array settings "scopes"
    |> List.fold_left
         (fun (scopes, errors) scope ->
           let name = get_string scope "scope" in
           let policy = Unsafe.get scope "execPolicy" in
           match scope_rules_from_js policy with
           | Ok rules -> ((name, rules) :: scopes, errors)
           | Error message ->
               let error = { Taumel.Exec_policy.scope = name; rule_index = -1; message } in
               ((name, []) :: scopes, error :: errors))
         ([], [])
  in
  let compiled = Taumel.Exec_policy.compile (List.rev scopes) in
  let compiled = { compiled with errors = List.rev_append scope_errors compiled.errors } in
  exec_policy := compiled;
  let errors = compiled.errors in
  ok_obj
    [
      ("activeRuleCount", js_number (float_of_int (Taumel.Exec_policy.active_rule_count compiled)));
      ("scopes", js_array (List.map js_string (Taumel.Exec_policy.contributing_scopes compiled)));
      ("errors", js_array (List.map (fun (error : Taumel.Exec_policy.compile_error) -> js_string (error.scope ^ ": " ^ error.message)) errors));
    ]
