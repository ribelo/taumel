let split_command args =
  let trimmed = String.trim args in
  if trimmed = "" then ("", "")
  else
    match String.index_opt trimmed ' ' with
    | None -> (trimmed, "")
    | Some index ->
        ( String.sub trimmed 0 index,
          String.sub trimmed (index + 1) (String.length trimmed - index - 1)
          |> String.trim )
