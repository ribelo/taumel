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
        git_delta = { added = 12; removed = 3 };
        provider = "openai-codex";
        model = "gpt-test";
        thinking = "medium";
        total_cost = 0.125;
        context_percent = 12.0;
        context_window = 200000.0;
      }
  in
  if not (String.contains line '$') then failwith "rendered line omits cost";
  if not (contains_substring line "Δ") then failwith "rendered line omits git delta";
  if not (String.contains line '%') then failwith "rendered line omits context usage";
  if not (String.contains line ':') then failwith "rendered line omits branch"

let () =
  test_parse_git_numstat ();
  test_format_token_window ();
  test_render_line ()
