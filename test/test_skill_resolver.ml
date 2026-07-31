module Skill = Taumel.Skill_resolver

let assert_equal label expected actual =
  if expected <> actual then
    failwith (Printf.sprintf "%s: expected %s, got %s" label expected actual)

let assert_list label expected actual =
  assert_equal label (String.concat "," expected) (String.concat "," actual)

let test_mentions () =
  assert_list "multiple ordered" [ "foo"; "bar" ]
    (Skill.mentions "yada $foo yada $bar");
  assert_list "dedupe first order" [ "bar"; "foo" ]
    (Skill.mentions "$bar $foo $bar");
  assert_list "trailing punctuation" [ "foo"; "bar-2" ]
    (Skill.mentions "$foo. ($bar-2)");
  assert_list "non matches" []
    (Skill.mentions "foo$bar $$baz \\$qux $Foo $5 $-bad");
  assert_list "boundary after punctuation" [ "foo" ]
    (Skill.mentions "hello,$foo")

let test_block () =
  let block =
    Skill.skill_block ~name:"foo" ~location:"/skills/foo/SKILL.md"
      ~base_dir:"/skills/foo" ~body:"\nDo the thing.\n"
  in
  assert_equal "block form"
    "<skill name=\"foo\" location=\"/skills/foo/SKILL.md\">\n\
     References are relative to /skills/foo.\n\n\
     Do the thing.\n\
     </skill>"
    block

let assert_pairs label expected actual =
  let render pairs =
    String.concat ","
      (List.map
         (fun (name, parent) ->
           match parent with None -> name | Some p -> name ^ "<" ^ p)
         pairs)
  in
  assert_equal label (render expected) (render actual)

let test_closure () =
  let fetch table name = List.assoc_opt name table in
  assert_pairs "direct only"
    [ ("a", None); ("c", None) ]
    (Skill.closure ~fetch:(fetch [ ("a", "do a"); ("c", "do c") ]) [ "a"; "c" ]);
  assert_pairs "breadth first"
    [ ("a", None); ("c", None); ("b", Some "a") ]
    (Skill.closure
       ~fetch:(fetch [ ("a", "use $b"); ("b", "do b"); ("c", "do c") ])
       [ "a"; "c" ]);
  assert_pairs "cycle"
    [ ("a", None); ("b", Some "a") ]
    (Skill.closure ~fetch:(fetch [ ("a", "use $b"); ("b", "use $a") ]) [ "a" ]);
  assert_pairs "self loop"
    [ ("a", None) ]
    (Skill.closure ~fetch:(fetch [ ("a", "use $a again") ]) [ "a" ]);
  assert_pairs "diamond"
    [ ("a", None); ("b", Some "a"); ("c", Some "a"); ("d", Some "b") ]
    (Skill.closure
       ~fetch:
         (fetch [ ("a", "$b $c"); ("b", "$d"); ("c", "$d too"); ("d", "done") ])
       [ "a" ]);
  assert_pairs "unresolvable nested"
    [ ("a", None); ("ghost", Some "a") ]
    (Skill.closure ~fetch:(fetch [ ("a", "mention $ghost") ]) [ "a" ]);
  assert_pairs "escaped nested"
    [ ("a", None) ]
    (Skill.closure ~fetch:(fetch [ ("a", "\\$b $$c") ]) [ "a" ]);
  assert_pairs "chain"
    [ ("a", None); ("b", Some "a"); ("c", Some "b") ]
    (Skill.closure ~fetch:(fetch [ ("a", "$b"); ("b", "$c"); ("c", "done") ]) [ "a" ])

let () =
  test_mentions ();
  test_block ();
  test_closure ()
