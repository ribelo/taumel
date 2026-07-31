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
    plan = None;
    activity = Footer.empty_activity;
  }

let test_parse_git_numstat () =
  let delta =
    Footer.parse_git_numstat
      "10\t2\tlib/a.ml\n-\t-\timage.png\n3\t4\tlib/b.ml\n"
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
        plan = None;
        activity = Footer.empty_activity;
      }
  in
  if not (String.contains line '$') then failwith "rendered line omits cost";
  if not (contains_substring line "Δ") then
    failwith "rendered line omits git delta";
  if not (String.contains line '%') then
    failwith "rendered line omits context usage";
  if not (String.contains line ':') then failwith "rendered line omits branch";
  if
    contains_substring line "danger-full-access"
    || contains_substring line "workspace-write"
    || contains_substring line "+net"
  then failwith "rendered line includes textual permission label"

let test_render_no_permission_label () =
  let line =
    Footer.render_line ~colorize:(fun _ text -> text) ~width:120 base_snapshot
  in
  if
    contains_substring line "read-only"
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
    (Footer.render_line ~colorize ~width:120
       {
         base_snapshot with
         filesystem_mode = "read-only";
         network_mode = "enabled";
         approval_policy = "untrusted";
       });
  let seen = !tokens in
  if seen <> [ "success"; "error"; "success" ] then
    failwith
      (Printf.sprintf
         "permission dot tokens: expected success/error/success, got %s"
         (String.concat "/" seen))

let test_no_sandbox_all_text_tokens () =
  let tokens = ref [] in
  let colorize token value =
    if List.length !tokens < 3 then tokens := !tokens @ [ token ];
    value
  in
  ignore
    (Footer.render_line ~colorize ~width:120
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
    Footer.render_line
      ~colorize:(fun _ text -> text)
      ~width:120
      {
        base_snapshot with
        git_delta = { added = 4; removed = 2 };
        git_repo;
        git_error;
      }
  in
  let non_repo = render false false in
  if contains_substring non_repo "main" || contains_substring non_repo "Δ" then
    failwith "non-git directory renders git information";
  let failed = render false true in
  if
    (not (contains_substring failed "git error"))
    || contains_substring failed "Δ"
  then failwith "git failure is hidden or rendered as a clean delta"

let test_narrow_width_preserves_colored_dots () =
  let line =
    Footer.render_line
      ~colorize:(fun token value -> "(" ^ token ^ ")" ^ value)
      ~width:8 base_snapshot
  in
  if
    not
      (contains_substring line "(warning)"
      && contains_substring line "(success)"
      && contains_substring line "(accent)")
  then
    failwith (Printf.sprintf "narrow footer flattened permission dots: %S" line)

let test_render_plan_status () =
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
           plan =
             Some
               {
                 status = Taumel.Plan.Active;
                 automation = Taumel.Plan.Automation_interrupted;
                 tasks = [];
                 completed_tasks = 1;
                 total_tasks = 2;
                 tokens_used = 0;
                 time_used_seconds = 720;
                 time_limit_seconds = Some 1800;
                 extension_unlocked = false;
                 plan_id = "g";
                 session_id = "s";
               };
         })
  in
  if
    not (contains_substring line "Plan (interrupted) · 1/2 · 12m/30m")
  then failwith "rendered line omits plan progress"
  else if contains_substring line "tokens" then
    failwith "rendered plan line includes token telemetry"

let sample_plan =
  {
    Taumel.Plan.status = Taumel.Plan.Active;
    automation = Taumel.Plan.Automation_enabled;
    tasks = [];
    completed_tasks = 0;
    total_tasks = 1;
    tokens_used = 0;
    time_used_seconds = 30;
    time_limit_seconds = None;
    extension_unlocked = false;
    plan_id = "g";
    session_id = "s";
  }

let sample_task title status =
  {
    Taumel.Plan.task_id = "t-" ^ title;
    title;
    description = None;
    status;
    cancellation_reason = None;
    depends_on = [];
    origin = Taumel.Plan.Agent;
  }

let in_progress_plan =
  {
    sample_plan with
    Taumel.Plan.tasks =
      [
        sample_task "Implement modal kit" Taumel.Plan.In_progress;
        sample_task "Second task" Taumel.Plan.In_progress;
        sample_task "Done" Taumel.Plan.Completed;
      ];
  }

let ends_with text suffix =
  let text_len = String.length text in
  let suffix_len = String.length suffix in
  text_len >= suffix_len
  && String.sub text (text_len - suffix_len) suffix_len = suffix

let visible_len text =
  let rec loop acc index =
    if index >= String.length text then acc
    else
      let code = Char.code text.[index] in
      let len =
        if code land 0x80 = 0 then 1
        else if code land 0xE0 = 0xC0 then 2
        else if code land 0xF0 = 0xE0 then 3
        else 4
      in
      loop (acc + 1) (index + len)
  in
  loop 0 0

let second_line ?(width = 160) ?(colorize = fun token text -> "[" ^ token ^ "]" ^ text) ?plan activity =
  match
    Footer.render_lines ~colorize ~width { base_snapshot with plan; activity }
  with
  | [ _; second ] -> second
  | lines ->
      failwith (Printf.sprintf "expected 2 lines, got %d" (List.length lines))

let activity ~agents ?(orphaned = 0) ?description ~execs () =
  {
    Footer.running_agents = agents;
    orphaned_agents = orphaned;
    single_agent_description = description;
    live_execs = execs;
  }

let test_activity_hidden_when_zero () =
  let lines =
    Footer.render_lines ~colorize:(fun _ text -> text) ~width:120 base_snapshot
  in
  assert_int "no activity lines" 1 (List.length lines)

let test_activity_counts_right_aligned () =
  let line = second_line (activity ~agents:2 ~execs:3 ()) in
  if not (contains_substring line "2 agents") then
    failwith "activity omits agent count";
  if not (contains_substring line "3 exec") then
    failwith "activity omits exec count";
  if not (ends_with line "3 exec") then
    failwith (Printf.sprintf "counts are not right-aligned: %S" line)

let test_center_single_agent_description () =
  let line =
    second_line (activity ~agents:1 ~description:"Investigate footer" ~execs:1 ())
  in
  if not (contains_substring line "Investigate footer") then
    failwith "single agent description missing from center";
  if not (contains_substring line "1 agents") then
    failwith "counts hidden for a single agent";
  if not (contains_substring line "1 exec") then
    failwith "counts hidden for a single exec"

let test_activity_orphaned_error () =
  let line =
    second_line (activity ~agents:1 ~orphaned:2 ~description:"stuck" ~execs:0 ())
  in
  if not (contains_substring line "[error]2 orphaned") then
    failwith "orphaned count missing error token"

let test_three_zones_with_plan () =
  let line = second_line ~plan:sample_plan (activity ~agents:2 ~execs:1 ()) in
  if not (contains_substring line "[dim]Plan") then
    failwith "plan segment missing from left zone";
  if contains_substring line "│" then
    failwith "old pipe separator survives";
  if not (contains_substring line "2 agents") then
    failwith "activity missing beside plan";
  if not (ends_with line "1 exec") then
    failwith (Printf.sprintf "counts are not right-aligned: %S" line)

let test_center_in_progress_tasks () =
  let line = second_line ~plan:in_progress_plan (activity ~agents:0 ~execs:0 ()) in
  if not (contains_substring line "Implement modal kit +1") then
    failwith (Printf.sprintf "center omits first in-progress task: %S" line);
  if contains_substring line "Second task" then
    failwith "center shows more than the first in-progress task"

let test_center_empty_without_in_progress () =
  let line = second_line ~plan:sample_plan (activity ~agents:0 ~execs:0 ()) in
  if contains_substring line "+1" then
    failwith "center shows a marker without in-progress tasks"

let test_plan_status_colors () =
  let blocked =
    second_line
      ~plan:
        {
          sample_plan with
          Taumel.Plan.status =
            Taumel.Plan.Blocked
              {
                Taumel.Plan_block.blocked_at = 0;
                reason = "waiting";
                source = Taumel.Plan_block.agent_source;
              };
        }
      (activity ~agents:0 ~execs:0 ())
  in
  if not (contains_substring blocked "[warning]Plan blocked") then
    failwith (Printf.sprintf "blocked plan missing warning color: %S" blocked);
  let complete =
    second_line ~plan:{ sample_plan with Taumel.Plan.status = Taumel.Plan.Complete }
      (activity ~agents:0 ~execs:0 ())
  in
  if not (contains_substring complete "[success]Plan complete") then
    failwith (Printf.sprintf "complete plan missing success color: %S" complete)

let test_second_line_never_exceeds_width () =
  let line =
    second_line ~width:40 ~colorize:(fun _ text -> text)
      ~plan:in_progress_plan
      (activity ~agents:2 ~orphaned:1 ~execs:3 ())
  in
  if visible_len line > 40 then
    failwith (Printf.sprintf "second line wraps: %S" line);
  if not (contains_substring line "agents") then
    failwith (Printf.sprintf "counts lost at narrow width: %S" line)

let test_activity_second_line_alone () =
  let line = second_line (activity ~agents:0 ~execs:2 ()) in
  if not (ends_with line "2 exec") then
    failwith (Printf.sprintf "activity-only second line not right-aligned: %S" line)

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
  test_render_plan_status ();
  test_activity_hidden_when_zero ();
  test_activity_counts_right_aligned ();
  test_center_single_agent_description ();
  test_activity_orphaned_error ();
  test_three_zones_with_plan ();
  test_center_in_progress_tasks ();
  test_center_empty_without_in_progress ();
  test_plan_status_colors ();
  test_second_line_never_exceeds_width ();
  test_activity_second_line_alone ()
