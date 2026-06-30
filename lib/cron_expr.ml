type field = { values : int list; wildcard : bool }

type t = {
  minutes : field;
  hours : field;
  days_of_month : field;
  months : field;
  days_of_week : field;
}

let range a b =
  let rec loop acc n = if n < a then acc else loop (n :: acc) (n - 1) in
  if a > b then [] else loop [] b

let unique_sorted values =
  values |> List.sort_uniq compare

let parse_int label min_v max_v value =
  match int_of_string_opt value with
  | Some n when n >= min_v && n <= max_v -> Ok n
  | _ -> Error (Printf.sprintf "%s value must be between %d and %d" label min_v max_v)

let parse_atom label min_v max_v text =
  match String.split_on_char '-' text with
  | [ "*" ] -> Ok (range min_v max_v)
  | [ one ] -> Result.map (fun n -> [ n ]) (parse_int label min_v max_v one)
  | [ left; right ] ->
      Result.bind (parse_int label min_v max_v left) (fun a ->
          Result.map
            (fun b -> if a > b then [] else range a b)
            (parse_int label min_v max_v right))
  | _ -> Error (label ^ " field is invalid")

let parse_part label min_v max_v text =
  match String.split_on_char '/' text with
  | [ base ] -> parse_atom label min_v max_v base
  | [ base; step_text ] -> (
      match int_of_string_opt step_text with
      | Some step when step > 0 ->
          Result.map
            (function
              | [] -> []
              | values ->
                  let anchor = List.hd values in
                  List.filter (fun n -> (n - anchor) mod step = 0) values)
            (parse_atom label min_v max_v base)
      | _ -> Error (label ^ " step must be positive"))
  | _ -> Error (label ^ " field is invalid")

let parse_field label min_v max_v text =
  let text = String.trim text in
  let wildcard = text = "*" in
  let parts = String.split_on_char ',' text in
  let rec loop acc = function
    | [] ->
        let values = unique_sorted acc in
        if values = [] then Error (label ^ " field matches no values")
        else Ok { values; wildcard }
    | part :: rest -> (
        match parse_part label min_v max_v part with
        | Error _ as error -> error
        | Ok values -> loop (values @ acc) rest)
  in
  loop [] parts

let parse expression =
  match String.split_on_char ' ' (String.trim expression) |> List.filter (( <> ) "") with
  | [ minute; hour; dom; month; dow ] ->
      Result.bind (parse_field "minute" 0 59 minute) (fun minutes ->
          Result.bind (parse_field "hour" 0 23 hour) (fun hours ->
              Result.bind (parse_field "day-of-month" 1 31 dom) (fun days_of_month ->
                  Result.bind (parse_field "month" 1 12 month) (fun months ->
                      Result.map
                        (fun days_of_week ->
                          { minutes; hours; days_of_month; months; days_of_week })
                        (parse_field "day-of-week" 0 7 dow)))))
  | _ -> Error "cron expression must contain exactly 5 fields"

let field_matches value field = List.mem value field.values

let day_of_week_matches weekday field =
  field_matches weekday field || (weekday = 0 && field_matches 7 field)

let day_matches expr ~day ~weekday =
  let dom = field_matches day expr.days_of_month in
  let dow = day_of_week_matches weekday expr.days_of_week in
  match (expr.days_of_month.wildcard, expr.days_of_week.wildcard) with
  | true, true -> true
  | true, false -> dow
  | false, true -> dom
  | false, false -> dom || dow

let matches expr ~minute ~hour ~day ~month ~weekday =
  field_matches minute expr.minutes
  && field_matches hour expr.hours
  && field_matches month expr.months
  && day_matches expr ~day ~weekday

let parts_of_epoch seconds =
  let tm = Unix.localtime (float_of_int seconds) in
  (tm.tm_min, tm.tm_hour, tm.tm_mday, tm.tm_mon + 1, tm.tm_wday)

let next_due_after expr ~after =
  let start = ((after / 60) + 1) * 60 in
  let rec loop remaining candidate =
    if remaining <= 0 then None
    else
      let minute, hour, day, month, weekday = parts_of_epoch candidate in
      if matches expr ~minute ~hour ~day ~month ~weekday then Some candidate
      else loop (remaining - 1) (candidate + 60)
  in
  loop (366 * 24 * 60 * 5) start

let describe expression = expression
