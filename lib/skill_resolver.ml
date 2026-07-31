let is_lower = function 'a' .. 'z' -> true | _ -> false

let is_digit = function '0' .. '9' -> true | _ -> false

let is_name_tail c = is_lower c || is_digit c || c = '-'

let blocks_start prev =
  not (is_lower prev || is_digit prev || prev = '$' || prev = '\\')

let mentions text =
  let length = String.length text in
  let rec scan index seen acc =
    if index >= length then List.rev acc
    else if text.[index] <> '$' then scan (index + 1) seen acc
    else
      let prev_ok = index = 0 || blocks_start text.[index - 1] in
      let start = index + 1 in
      if (not prev_ok) || start >= length || not (is_lower text.[start]) then
        scan (index + 1) seen acc
      else
        let stop = ref (start + 1) in
        while !stop < length && is_name_tail text.[!stop] do
          incr stop
        done;
        let name = String.sub text start (!stop - start) in
        if List.mem name seen then scan !stop seen acc
        else scan !stop (name :: seen) (name :: acc)
  in
  scan 0 [] []

let closure ~fetch names =
  let rec bfs queue seen acc =
    match queue with
    | [] -> List.rev acc
    | (name, parent) :: rest ->
        let discovered =
          match fetch name with
          | None -> []
          | Some body ->
              List.filter
                (fun candidate -> not (List.mem candidate seen))
                (mentions body)
        in
        let seen = discovered @ seen in
        bfs
          (rest @ List.map (fun nested -> (nested, Some name)) discovered)
          seen ((name, parent) :: acc)
  in
  bfs (List.map (fun name -> (name, None)) names) names []

let skill_block ~name ~location ~base_dir ~body =
  Printf.sprintf
    "<skill name=\"%s\" location=\"%s\">\n\
     References are relative to %s.\n\n\
     %s\n\
     </skill>"
    name location base_dir (String.trim body)
