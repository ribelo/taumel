(** Small global helpers used across the host bridge (Date / Math). *)

let now_ms () =
  let date = Ojs.get_prop_ascii Ojs.global "Date" in
  let now = Ojs.get_prop_ascii date "now" in
  if Ojs.type_of now <> "function" then 0.
  else
    try Ojs.float_of_js (Ojs.apply now [||]) with _ -> 0.

let random () =
  let math = Ojs.get_prop_ascii Ojs.global "Math" in
  let random = Ojs.get_prop_ascii math "random" in
  if Ojs.type_of random <> "function" then 0.
  else
    try Ojs.float_of_js (Ojs.apply random [||]) with _ -> 0.
