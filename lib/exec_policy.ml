type decision = Allow | Prompt | Forbidden

type token = One of string | Alternatives of string list

type rule = {
  id : string;
  scope : string;
  pattern : token list;
  decision : decision;
  justification : string option;
  match_examples : example list;
  not_match_examples : example list;
}

and example = Tokens of string list | Script of string

type node = { kind : string; text : string; children : node list }

type compiled_rule = {
  rule : rule;
  matched_examples : string list;
}

type compile_error = { scope : string; rule_index : int; message : string }

type compiled = {
  rules : compiled_rule list;
  scopes : string list;
  errors : compile_error list;
}

type matched_rule = {
  id : string;
  scope : string;
  decision : decision;
  pattern : token list;
  justification : string option;
}

type check = {
  decision : decision;
  matched_rules : matched_rule list;
  tokens : string list;
  defaulted_to_prompt : bool;
}

type unmatched_context = {
  approval_never : bool;
  approval_prompts_available : bool;
  sandbox_restricted : bool;
  sandbox_disabled : bool;
  requests_sandbox_override : bool;
}

type raw_rule = {
  raw_id : string option;
  raw_pattern : token list;
  raw_decision : decision;
  raw_justification : string option;
  raw_match_examples : example list;
  raw_not_match_examples : example list;
}

let empty = { rules = []; scopes = []; errors = [] }

let decision_rank = function Allow -> 0 | Prompt -> 1 | Forbidden -> 2
let strictest left right = if decision_rank left >= decision_rank right then left else right
let decision_to_string = function Allow -> "allow" | Prompt -> "prompt" | Forbidden -> "forbidden"

let decision_of_string = function
  | "allow" -> Some Allow
  | "prompt" -> Some Prompt
  | "forbidden" | "deny" -> Some Forbidden
  | _ -> None

let rec string_of_pattern = function
  | [] -> ""
  | One token :: rest -> token ^ if rest = [] then "" else " " ^ string_of_pattern rest
  | Alternatives values :: rest ->
      "[" ^ String.concat "|" values ^ "]"
      ^ if rest = [] then "" else " " ^ string_of_pattern rest

let token_matches pattern_token command_token =
  match pattern_token with
  | One expected -> expected = command_token
  | Alternatives values -> List.exists (( = ) command_token) values

let matches_pattern pattern tokens =
  let rec loop pattern tokens =
    match (pattern, tokens) with
    | [], _ -> true
    | _ :: _, [] -> false
    | pattern_token :: pattern_rest, token :: token_rest ->
        token_matches pattern_token token && loop pattern_rest token_rest
  in
  loop pattern tokens

let matching_rules compiled tokens =
  compiled.rules
  |> List.filter_map (fun compiled_rule ->
         let rule = compiled_rule.rule in
         if matches_pattern rule.pattern tokens then
           Some
             {
               id = rule.id;
               scope = rule.scope;
               decision = rule.decision;
               pattern = rule.pattern;
               justification = rule.justification;
             }
         else None)

let decide_tokens compiled tokens =
  let matched_rules = matching_rules compiled tokens in
  let defaulted_to_prompt = matched_rules = [] && compiled.errors <> [] in
  let decision =
    match matched_rules with
    | [] -> if compiled.errors = [] then Allow else Prompt
    | first :: rest ->
        List.fold_left
          (fun acc (matched : matched_rule) -> strictest acc matched.decision)
          first.decision rest
  in
  { decision; matched_rules; tokens; defaulted_to_prompt }

let split_words script =
  script |> String.split_on_char ' ' |> List.filter (fun part -> String.trim part <> "")

let tokens_of_example = function Tokens tokens -> tokens | Script script -> split_words script

let rec has_error_node node =
  node.kind = "ERROR" || List.exists has_error_node node.children

let words_from_command children =
  let word_text child =
    match child.kind with
    | "command_name" ->
        if List.for_all (fun grandchild -> grandchild.kind = "word" && grandchild.children = []) child.children then
          Some child.text
        else None
    | "word" | "number" when child.children = [] -> Some child.text
    | "string" | "raw_string" -> Some child.text
    | _ -> None
  in
  let rec loop acc = function
    | [] -> Some (List.rev acc)
    | child :: rest -> (
        match word_text child with
        | Some text -> loop (text :: acc) rest
        | None -> None)
  in
  loop [] children

let command_token_sequences_from_ast root =
  if has_error_node root then Error "command parse failed"
  else
    let rec walk node acc =
      match node.kind with
      | "program" | "list" | "pipeline" | "and_or" | "compound_statement" ->
          walk_children node.children acc
      | "command" | "simple_command" -> (
          match words_from_command node.children with
          | Some (_ :: _ as words) -> Ok (words :: acc)
          | Some [] -> Ok acc
          | None -> Error "command contains unsupported shell syntax")
      | "&&" | "||" | ";" | "|" -> Ok acc
      | _ when node.children = [] -> Error ("unsupported shell syntax: " ^ node.kind)
      | _ -> Error ("unsupported shell syntax: " ^ node.kind)
    and walk_children children acc =
      match children with
      | [] -> Ok acc
      | child :: rest -> (
          match walk child acc with
          | Error _ as error -> error
          | Ok acc -> walk_children rest acc)
    in
    walk root [] |> Result.map List.rev

let command_tokens_from_ast root =
  command_token_sequences_from_ast root |> Result.map List.concat

let decide_ast compiled root =
  match command_token_sequences_from_ast root with
  | Error _ -> { decision = Prompt; matched_rules = []; tokens = []; defaulted_to_prompt = false }
  | Ok [] -> decide_tokens compiled []
  | Ok sequences ->
      let checks = List.map (decide_tokens compiled) sequences in
      let decision =
        List.fold_left
          (fun acc check -> strictest acc check.decision)
          Allow checks
      in
      let matched_rules =
        checks |> List.concat_map (fun check -> check.matched_rules)
      in
      let defaulted_to_prompt =
        matched_rules = [] && List.exists (fun check -> check.defaulted_to_prompt) checks
      in
      { decision; matched_rules; tokens = List.concat sequences; defaulted_to_prompt }

let override_decision check =
  if check.matched_rules <> [] || check.defaulted_to_prompt then Some check.decision
  else None

let validate_rule scope rule_index rule =
  let rule_id = Option.value rule.raw_id ~default:(Printf.sprintf "%s#%d" scope rule_index) in
  let full_rule =
    {
      id = rule_id;
      scope;
      pattern = rule.raw_pattern;
      decision = rule.raw_decision;
      justification = rule.raw_justification;
      match_examples = rule.raw_match_examples;
      not_match_examples = rule.raw_not_match_examples;
    }
  in
  let singleton = { empty with rules = [ { rule = full_rule; matched_examples = [] } ] } in
  let validate_match example =
    let tokens = tokens_of_example example in
    let result = decide_tokens singleton tokens in
    result.decision = rule.raw_decision && result.matched_rules <> []
  in
  let validate_not_match example =
    let tokens = tokens_of_example example in
    let result = decide_tokens singleton tokens in
    result.matched_rules = []
  in
  match List.find_opt (fun example -> not (validate_match example)) rule.raw_match_examples with
  | Some _ -> Error { scope; rule_index; message = "match example does not resolve to this rule" }
  | None -> (
      match List.find_opt (fun example -> not (validate_not_match example)) rule.raw_not_match_examples with
      | Some _ -> Error { scope; rule_index; message = "not_match example resolves to this rule" }
      | None -> Ok { rule = full_rule; matched_examples = [] })

let compile scoped_rules =
  let scopes =
    scoped_rules |> List.map fst |> List.filter (fun scope -> scope <> "")
    |> List.sort_uniq String.compare
  in
  let rules, errors =
    scoped_rules
    |> List.fold_left
         (fun (rules, errors) (scope, raw_rules) ->
           raw_rules
           |> List.mapi (fun index rule -> (index, rule))
           |> List.fold_left
                (fun (rules, errors) (index, rule) ->
                  match validate_rule scope index rule with
                  | Ok rule -> (rule :: rules, errors)
                  | Error error -> (rules, error :: errors))
                (rules, errors))
         ([], [])
  in
  { rules = List.rev rules; scopes; errors = List.rev errors }

let active_rule_count compiled = List.length compiled.rules
let contributing_scopes compiled = compiled.scopes

let basename path =
  match List.rev (String.split_on_char '/' path) with
  | name :: _ when name <> "" -> name
  | _ -> path

let executable_name_lookup_key raw = basename raw

let command_name command =
  match command with
  | [] -> None
  | first :: _ -> Some (executable_name_lookup_key first)

let arg_starts_with prefix arg =
  String.length arg >= String.length prefix
  && String.sub arg 0 (String.length prefix) = prefix

let git_global_option_with_value = function
  | "-C" | "-c" | "--config-env" | "--exec-path" | "--git-dir"
  | "--namespace" | "--super-prefix" | "--work-tree" -> true
  | _ -> false

let git_global_option_with_inline_value arg =
  List.exists (fun prefix -> arg_starts_with prefix arg)
    [ "--config-env="; "--exec-path="; "--git-dir="; "--namespace="; "--super-prefix="; "--work-tree=" ]
  || ((arg_starts_with "-C" arg || arg_starts_with "-c" arg) && String.length arg > 2)

let find_git_subcommand command subcommands =
  match command_name command with
  | Some "git" ->
      let rec loop index skip_next = function
        | [] -> None
        | _ :: rest when index = 0 -> loop 1 false rest
        | _ :: rest when skip_next -> loop (index + 1) false rest
        | arg :: rest ->
            if git_global_option_with_inline_value arg then loop (index + 1) false rest
            else if git_global_option_with_value arg then loop (index + 1) true rest
            else if arg = "--" || arg_starts_with "-" arg then loop (index + 1) false rest
            else if List.mem arg subcommands then Some (index, arg)
            else None
      in
      loop 0 false command
  | _ -> None

let git_has_config_override_global_option command =
  List.exists
    (fun arg ->
      arg = "-c" || arg = "--config-env"
      || (arg_starts_with "-c" arg && String.length arg > 2)
      || arg_starts_with "--config-env=" arg)
    command

let git_subcommand_args_are_read_only args =
  let unsafe_flags = [ "--output"; "--ext-diff"; "--textconv"; "--exec"; "--paginate" ] in
  not
    (List.exists
       (fun arg ->
         List.mem arg unsafe_flags || arg_starts_with "--output=" arg
         || arg_starts_with "--exec=" arg)
       args)

let git_branch_is_read_only args =
  match args with
  | [] -> true
  | _ ->
      let saw_read_only = ref false in
      List.for_all
        (fun arg ->
          match arg with
          | "--list" | "-l" | "--show-current" | "-a" | "--all" | "-r"
          | "--remotes" | "-v" | "-vv" | "--verbose" ->
              saw_read_only := true;
              true
          | _ when arg_starts_with "--format=" arg ->
              saw_read_only := true;
              true
          | _ -> false)
        args
      && !saw_read_only

let is_valid_sed_n_arg = function
  | None -> false
  | Some arg -> (
      match String.ends_with ~suffix:"p" arg with
      | false -> false
      | true ->
          let core = String.sub arg 0 (String.length arg - 1) in
          let numeric value = value <> "" && String.for_all (fun ch -> ch >= '0' && ch <= '9') value in
          match String.split_on_char ',' core with
          | [ one ] -> numeric one
          | [ left; right ] -> numeric left && numeric right
          | _ -> false)

let is_safe_to_call_with_exec command =
  match command_name command with
  | Some ("numfmt" | "tac") -> true
  | Some
      ( "cat" | "cd" | "cut" | "echo" | "expr" | "false" | "grep" | "head"
      | "id" | "ls" | "nl" | "paste" | "pwd" | "rev" | "seq" | "stat"
      | "tail" | "tr" | "true" | "uname" | "uniq" | "wc" | "which" | "whoami" ) ->
      true
  | Some "base64" ->
      not
        (List.exists
           (fun arg ->
             arg = "-o" || arg = "--output" || arg_starts_with "--output=" arg
             || (arg_starts_with "-o" arg && arg <> "-o"))
           (List.tl command))
  | Some "find" ->
      let unsafe_options =
        [ "-exec"; "-execdir"; "-ok"; "-okdir"; "-delete"; "-fls"; "-fprint"; "-fprint0"; "-fprintf" ]
      in
      not (List.exists (fun arg -> List.mem arg unsafe_options) command)
  | Some "rg" ->
      let unsafe_without_args = [ "--search-zip"; "-z" ] in
      let unsafe_with_args = [ "--pre"; "--hostname-bin" ] in
      not
        (List.exists
           (fun arg ->
             List.mem arg unsafe_without_args
             || List.exists
                  (fun opt -> arg = opt || arg_starts_with (opt ^ "=") arg)
                  unsafe_with_args)
           command)
  | Some "git" -> (
      if git_has_config_override_global_option command then false
      else
        match find_git_subcommand command [ "status"; "log"; "diff"; "show"; "branch" ] with
        | None -> false
        | Some (index, subcommand) ->
            let args = command |> List.mapi (fun i value -> (i, value)) |> List.filter_map (fun (i, value) -> if i > index then Some value else None) in
            (match subcommand with
            | "status" | "log" | "diff" | "show" -> git_subcommand_args_are_read_only args
            | "branch" -> git_subcommand_args_are_read_only args && git_branch_is_read_only args
            | _ -> false))
  | Some "sed" ->
      List.length command <= 4
      && List.nth_opt command 1 = Some "-n"
      && is_valid_sed_n_arg (List.nth_opt command 2)
  | _ -> false

let rec is_dangerous_to_call_with_exec command =
  match command with
  | "rm" :: ("-f" | "-rf") :: _ -> true
  | "sudo" :: rest -> is_dangerous_to_call_with_exec rest
  | _ -> false

let is_known_safe_command = is_safe_to_call_with_exec
let command_might_be_dangerous = is_dangerous_to_call_with_exec

let decision_for_unmatched_command context command =
  if command_might_be_dangerous command && context.sandbox_disabled then
    if context.approval_never then Forbidden else Prompt
  else if is_known_safe_command command then Allow
  else if context.sandbox_restricted then
    if context.requests_sandbox_override && context.approval_prompts_available then Prompt
    else Allow
  else if context.approval_never || not context.approval_prompts_available then Allow
  else Allow

let decide_ast_with_fallback compiled context root =
  match command_token_sequences_from_ast root with
  | Error _ -> { decision = Prompt; matched_rules = []; tokens = []; defaulted_to_prompt = false }
  | Ok [] ->
      let decision = decision_for_unmatched_command context [] in
      { decision; matched_rules = []; tokens = []; defaulted_to_prompt = decision = Prompt }
  | Ok sequences ->
      let checks = List.map (decide_tokens compiled) sequences in
      let command_checks = List.combine sequences checks in
      let decision =
        List.fold_left
          (fun acc (tokens, check) ->
            let command_decision =
              if check.matched_rules = [] then decision_for_unmatched_command context tokens
              else check.decision
            in
            strictest acc command_decision)
          Allow command_checks
      in
      let matched_rules = checks |> List.concat_map (fun check -> check.matched_rules) in
      let defaulted_to_prompt =
        matched_rules = []
        && List.exists
             (fun (tokens, check) ->
               check.defaulted_to_prompt
               || (check.matched_rules = []
                  && decision_for_unmatched_command context tokens = Prompt))
             command_checks
      in
      { decision; matched_rules; tokens = List.concat sequences; defaulted_to_prompt }
