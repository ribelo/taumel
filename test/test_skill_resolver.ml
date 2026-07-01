module Skill = Taumel.Skill_resolver

let assert_equal label expected actual =
  if expected <> actual then
    failwith
      (Printf.sprintf "%s: expected %s, got %s" label expected actual)

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
    "<skill name=\"foo\" location=\"/skills/foo/SKILL.md\">\nReferences are relative to /skills/foo.\n\nDo the thing.\n</skill>"
    block

let () =
  test_mentions ();
  test_block ()
