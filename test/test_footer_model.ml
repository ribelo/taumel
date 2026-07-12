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
        no_sandbox = false;
        git_delta = { added = 12; removed = 3 };
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
  if not (String.contains line ':') then failwith "rendered line omits branch"

let test_render_workspace_sandbox_label () =
  let line =
    Footer.render_line
      ~colorize:(fun _ text -> text)
      ~width:120
      {
        cwd = "/repo";
        branch = "main";
        filesystem_mode = "workspace-write";
        network_mode = "disabled";
        no_sandbox = false;
        git_delta = { added = 0; removed = 0 };
        provider = "openai-codex";
        model = "gpt-test";
        thinking = "medium";
        total_cost = 0.0;
        context_percent = 0.0;
        context_window = 0.0;
        goal = None;
      }
  in
  if not (contains_substring line "workspace-write") then
    failwith "rendered line abbreviates workspace sandbox";
  if contains_substring line " ww " then
    failwith "rendered line uses old workspace sandbox abbreviation"

let test_render_missing_model_defaults () =
  let line =
    Footer.render_line
      ~colorize:(fun _ text -> text)
      ~width:120
      {
        cwd = "/repo";
        branch = "main";
        filesystem_mode = "workspace-write";
        network_mode = "disabled";
        no_sandbox = false;
        git_delta = { added = 0; removed = 0 };
        provider = "";
        model = "";
        thinking = "";
        total_cost = 0.0;
        context_percent = 0.0;
        context_window = 0.0;
        goal = None;
      }
  in
  if not (contains_substring line "no-model • off") then
    failwith "rendered line omits OCaml model/thinking defaults"

let test_render_no_sandbox () =
  let line =
    Footer.render_line
      ~colorize:(fun _ text -> text)
      ~width:120
      {
        cwd = "/repo";
        branch = "main";
        filesystem_mode = "danger-full-access";
        network_mode = "enabled";
        no_sandbox = true;
        git_delta = { added = 0; removed = 0 };
        provider = "openai-codex";
        model = "gpt-test";
        thinking = "medium";
        total_cost = 0.0;
        context_percent = 0.0;
        context_window = 0.0;
        goal = None;
      }
  in
  if not (contains_substring line "no-sandbox") then
    failwith "rendered line omits no-sandbox state"

let test_render_goal_status () =
  let line =
    String.concat "\n" (Footer.render_lines
      ~colorize:(fun _ text -> text)
      ~width:160
      {
        cwd = "/repo";
        branch = "main";
        filesystem_mode = "danger-full-access";
        network_mode = "enabled";
        no_sandbox = false;
        git_delta = { added = 0; removed = 0 };
        provider = "openai-codex";
        model = "gpt-test";
        thinking = "medium";
        total_cost = 0.0;
        context_percent = 0.0;
        context_window = 0.0;
        goal = Some { status = Taumel.Goal.Active; automation = Taumel.Goal.Automation_enabled; objective = "ship"; tokens_used = 0; time_used_seconds = 720; time_limit_seconds = Some 1800; goal_id = "g"; session_id = "s" };
      })
  in
  if not (contains_substring line "Goal active · ship · 12m/30m") then
    failwith "rendered line omits goal status"

let () =
  test_parse_git_numstat ();
  test_format_token_window ();
  test_render_line ();
  test_render_workspace_sandbox_label ();
  test_render_missing_model_defaults ();
  test_render_no_sandbox ();
  test_render_goal_status ()
