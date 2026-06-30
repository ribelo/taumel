type field = int list

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
            (List.filter (fun n -> (n - min_v) mod step = 0))
            (parse_atom label min_v max_v base)
      | _ -> Error (label ^ " step must be positive"))
  | _ -> Error (label ^ " field is invalid")

let parse_field label min_v max_v text =
  let parts = String.split_on_char ',' text in
  let rec loop acc = function
    | [] ->
        let values = unique_sorted acc in
        if values = [] then Error (label ^ " field matches no values") else Ok values
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

let matches expr ~minute ~hour ~day ~month ~weekday =
  List.mem minute expr.minutes
  && List.mem hour expr.hours
  && List.mem day expr.days_of_month
  && List.mem month expr.months
  && (List.mem weekday expr.days_of_week
     || (weekday = 0 && List.mem 7 expr.days_of_week))

let div_floor a b =
  let q = a / b and r = a mod b in
  if r <> 0 && ((r < 0) <> (b < 0)) then q - 1 else q

let civil_from_days z =
  let z = z + 719468 in
  let era = div_floor (if z >= 0 then z else z - 146096) 146097 in
  let doe = z - (era * 146097) in
  let yoe = (doe - (doe / 1460) + (doe / 36524) - (doe / 146096)) / 365 in
  let y = yoe + (era * 400) in
  let doy = doe - ((365 * yoe) + (yoe / 4) - (yoe / 100)) in
  let mp = ((5 * doy) + 2) / 153 in
  let d = doy - (((153 * mp) + 2) / 5) + 1 in
  let m = mp + if mp < 10 then 3 else -9 in
  let y = y + if m <= 2 then 1 else 0 in
  (y, m, d)

let parts_of_epoch seconds =
  let days = div_floor seconds 86400 in
  let rem = seconds - (days * 86400) in
  let hour = rem / 3600 in
  let minute = (rem mod 3600) / 60 in
  let _, month, day = civil_from_days days in
  let weekday = (days + 4) mod 7 in
  let weekday = if weekday < 0 then weekday + 7 else weekday in
  (minute, hour, day, month, weekday)

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
