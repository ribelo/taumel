module Footer = Taumel.Footer_model

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %S, got %S" label expected actual)

let assert_int label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %d, got %d" label expected actual)

let contains_substring haystack needle =
  let haystack_len = String.length haystack in
  let needle_len = String.length needle in
  let rec loop index =
    if index + needle_len > haystack_len then false
    else if String.sub haystack index needle_len = needle then true
    else loop (index + 1)
  in
  needle_len = 0 || loop 0

let base_snapshot =
  {
    Footer.cwd = "/repo";
    branch = "main";
    filesystem_mode = "workspace-write";
    network_mode = "disabled";
    approval_policy = "on-request";
    no_sandbox = false;
    git_delta = { added = 0; removed = 0 };
    git_repo = true;
    git_error = false;
    provider = "";
    model = "model";
    thinking = "off";
    total_cost = 0.0;
    context_percent = 0.0;
    context_window = 0.0;
    goal = None;
  }

let test_parse_git_numstat () =
  let delta =
    Footer.parse_git_numstat "10\t2\tlib/a.ml\n-\t-\timage.png\n3\t4\tlib/b.ml\n"
  in
  assert_int "added" 13 delta.added;
  assert_int "removed" 6 delta.removed

let test_format_token_window () =
  assert_equal "small" "512" (Footer.format_token_window 512.0);
  assert_equal "round k" "200k" (Footer.format_token_window 200000.0);
  assert_equal "decimal k" "1.5k" (Footer.format_token_window 1536.0)

let test_render_line () =
  let line =
    Footer.render_line
      ~colorize:(fun _ text -> text)
      ~width:120
      {
        cwd = "/home/ribelo/projects/ribelo/taumel";
        branch = "main";
        filesystem_mode = "danger-full-access";
        network_mode = "disabled";
        approval_policy = "on-request";
        no_sandbox = false;
        git_delta = { added = 12; removed = 3 };
        git_repo = true;
        git_error = false;
        provider = "openai-codex";
        model = "gpt-test";
        thinking = "medium";
        total_cost = 0.125;
        context_percent = 12.0;
        context_window = 200000.0;
        goal = None;
      }
  in
  if not (String.contains line '$') then failwith "rendered line omits cost";
  if not (contains_substring line "Δ") then failwith "rendered line omits git delta";
  if not (String.contains line '%') then failwith "rendered line omits context usage";
  if not (String.contains line ':') then failwith "rendered line omits branch";
  if contains_substring line "danger-full-access"
     || contains_substring line "workspace-write"
     || contains_substring line "+net"
  then failwith "rendered line includes textual permission label"

let test_render_no_permission_label () =
  let line =
    Footer.render_line ~colorize:(fun _ text -> text) ~width:120 base_snapshot
  in
  if contains_substring line "read-only"
     || contains_substring line "workspace-write"
     || contains_substring line "danger-full-access"
     || contains_substring line "no-sandbox"
     || contains_substring line "+net"
  then failwith "footer renders permission text instead of dots only";
  if not (contains_substring line "•••") then
    failwith "footer omits three permission dots"

let test_render_missing_model_defaults () =
  let line =
    Footer.render_line
      ~colorize:(fun _ text -> text)
      ~width:120
      { base_snapshot with provider = ""; model = ""; thinking = "" }
  in
  if not (contains_substring line "no-model • off") then
    failwith "rendered line omits OCaml model/thinking defaults"

let test_permission_dot_tokens () =
  let tokens = ref [] in
  let colorize token value =
    if List.length !tokens < 3 then tokens := !tokens @ [ token ];
    "[" ^ token ^ "]" ^ value
  in
  ignore
    (Footer.render_line
       ~colorize
       ~width:120
       {
         base_snapshot with
         filesystem_mode = "read-only";
         network_mode = "enabled";
         approval_policy = "untrusted";
       });
  let seen = !tokens in
  if seen <> [ "success"; "error"; "success" ] then
    failwith
      (Printf.sprintf "permission dot tokens: expected success/error/success, got %s"
         (String.concat "/" seen))

let test_no_sandbox_all_text_tokens () =
  let tokens = ref [] in
  let colorize token value =
    if List.length !tokens < 3 then tokens := !tokens @ [ token ];
    value
  in
  ignore
    (Footer.render_line
       ~colorize
       ~width:120
       {
         base_snapshot with
         filesystem_mode = "danger-full-access";
         network_mode = "enabled";
         approval_policy = "never";
         no_sandbox = true;
       });
  if !tokens <> [ "text"; "text"; "text" ] then
    failwith
      (Printf.sprintf "no-sandbox dots: expected three text tokens, got %s"
         (String.concat "/" !tokens))

let test_render_git_states () =
  let render git_repo git_error =
    Footer.render_line ~colorize:(fun _ text -> text) ~width:120
      { base_snapshot with git_delta = { added = 4; removed = 2 }; git_repo; git_error }
  in
  let non_repo = render false false in
  if contains_substring non_repo "main" || contains_substring non_repo "Δ" then
    failwith "non-git directory renders git information";
  let failed = render false true in
  if not (contains_substring failed "git error") || contains_substring failed "Δ" then
    failwith "git failure is hidden or rendered as a clean delta"

let test_narrow_width_preserves_colored_dots () =
  let line =
    Footer.render_line
      ~colorize:(fun token value -> "(" ^ token ^ ")" ^ value)
      ~width:8
      base_snapshot
  in
  if not
       (contains_substring line "(warning)"
        && contains_substring line "(success)"
        && contains_substring line "(accent)")
  then
    failwith
      (Printf.sprintf "narrow footer flattened permission dots: %S" line)

let test_render_goal_status () =
  let line =
    String.concat "\n"
      (Footer.render_lines
         ~colorize:(fun _ text -> text)
         ~width:160
         {
           base_snapshot with
           filesystem_mode = "danger-full-access";
           network_mode = "enabled";
           approval_policy = "on-request";
           provider = "openai-codex";
           model = "gpt-test";
           thinking = "medium";
           goal =
             Some
               {
                 status = Taumel.Goal.Active;
                 automation = Taumel.Goal.Automation_enabled;
                 objective = "ship";
                 tokens_used = 0;
                 time_used_seconds = 720;
                 time_limit_seconds = Some 1800;
                 goal_id = "g";
                 session_id = "s";
               };
         })
  in
  if not (contains_substring line "Goal active · ship · 12m/30m") then
    failwith "rendered line omits goal status"

let () =
  test_parse_git_numstat ();
  test_format_token_window ();
  test_render_line ();
  test_render_no_permission_label ();
  test_render_missing_model_defaults ();
  test_permission_dot_tokens ();
  test_no_sandbox_all_text_tokens ();
  test_render_git_states ();
  test_narrow_width_preserves_colored_dots ();
  test_render_goal_status ()