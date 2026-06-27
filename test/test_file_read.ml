module File_read = Taumel.File_read

let fail label message = failwith (Printf.sprintf "%s: %s" label message)
let assert_bool label condition = if not condition then fail label "expected true"

let assert_int label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %d, got %d" label expected actual)

let contains label haystack needle =
  let hl = String.length haystack and nl = String.length needle in
  let rec loop i = i + nl <= hl && (String.sub haystack i nl = needle || loop (i + 1)) in
  if not (loop 0) then
    failwith (Printf.sprintf "%s: %S does not contain %S" label haystack needle)

let not_contains label haystack needle =
  let hl = String.length haystack and nl = String.length needle in
  let rec loop i = i + nl <= hl && (String.sub haystack i nl = needle || loop (i + 1)) in
  if loop 0 then failwith (Printf.sprintf "%s: %S unexpectedly contains %S" label haystack needle)

let rendered label = function
  | File_read.Rendered r -> r
  | File_read.Binary_content -> fail label "expected Rendered, got Binary_content"
  | File_read.Out_of_bounds _ -> fail label "expected Rendered, got Out_of_bounds"

let () =
  (* Basic: line-number prefix, total/shown counts, no footer. *)
  let r = rendered "basic" (File_read.format ~content:"alpha\nbeta\ngamma\n" ~offset:None ~limit:None) in
  assert_int "basic.total" 3 r.total_lines;
  assert_int "basic.shown" 3 r.shown_lines;
  assert_int "basic.start" 1 r.start_line;
  assert_bool "basic.not-truncated" (not r.truncated);
  contains "basic.body" r.body "1\talpha";
  contains "basic.body" r.body "3\tgamma";

  (* offset (1-indexed) + limit, with continuation footer. *)
  let r = rendered "offset" (File_read.format ~content:"l1\nl2\nl3\nl4\nl5\n" ~offset:(Some 2) ~limit:(Some 2)) in
  assert_int "offset.start" 2 r.start_line;
  assert_int "offset.shown" 2 r.shown_lines;
  contains "offset.body" r.body "2\tl2";
  contains "offset.body" r.body "3\tl3";
  not_contains "offset.body" r.body "4\tl4";
  contains "offset.footer" r.body "Use offset=4 to continue.";

  (* negative offset = tail. *)
  let r = rendered "tail" (File_read.format ~content:"a\nb\nc\nd\ne\n" ~offset:(Some (-2)) ~limit:None) in
  assert_int "tail.start" 4 r.start_line;
  assert_int "tail.shown" 2 r.shown_lines;
  contains "tail.body" r.body "4\td";
  contains "tail.body" r.body "5\te";
  not_contains "tail.body" r.body "3\tc";

  (* offset beyond end. *)
  (match File_read.format ~content:"a\nb\n" ~offset:(Some 9) ~limit:None with
   | File_read.Out_of_bounds { offset; total } ->
       assert_int "oob.offset" 9 offset;
       assert_int "oob.total" 2 total
   | _ -> fail "oob" "expected Out_of_bounds");

  (* binary (NUL byte). *)
  (match File_read.format ~content:"ok\000binary" ~offset:None ~limit:None with
   | File_read.Binary_content -> ()
   | _ -> fail "binary" "expected Binary_content");

  (* per-line truncation of a very long line. *)
  let long = String.make 5000 'x' in
  let r = rendered "longline" (File_read.format ~content:(long ^ "\n") ~offset:None ~limit:None) in
  assert_bool "longline.truncated" r.truncated;
  contains "longline.marker" r.body "...";
  contains "longline.note" r.body "truncated to 2000 chars";

  (* line cap: more than max_lines. *)
  let buf = Buffer.create 4096 in
  for i = 1 to 2500 do Buffer.add_string buf (Printf.sprintf "line%d\n" i) done;
  let r = rendered "linecap" (File_read.format ~content:(Buffer.contents buf) ~offset:None ~limit:None) in
  assert_int "linecap.total" 2500 r.total_lines;
  assert_int "linecap.shown" File_read.max_lines r.shown_lines;
  assert_bool "linecap.truncated" r.truncated;
  contains "linecap.footer" r.body "of 2500. Use offset=2001 to continue.";

  (* CRLF: \r stripped from the model view. *)
  let r = rendered "crlf" (File_read.format ~content:"a\r\nb\r\n" ~offset:None ~limit:None) in
  contains "crlf.body" r.body "1\ta";
  not_contains "crlf.body" r.body "\r";

  (* empty file. *)
  let r = rendered "empty" (File_read.format ~content:"" ~offset:None ~limit:None) in
  assert_int "empty.total" 0 r.total_lines;
  assert_int "empty.shown" 0 r.shown_lines;

  print_endline "test_file_read: ok"
