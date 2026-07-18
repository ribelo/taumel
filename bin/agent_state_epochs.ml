let epochs : (string, int) Hashtbl.t = Hashtbl.create 32
let key owner_id agent_id = owner_id ^ "\000" ^ agent_id

let current ~owner_id ~agent_id =
  Option.value (Hashtbl.find_opt epochs (key owner_id agent_id)) ~default:0

let advance ~owner_id ~agent_id =
  let next = current ~owner_id ~agent_id + 1 in
  Hashtbl.replace epochs (key owner_id agent_id) next;
  next

let discard_owner owner_id =
  Hashtbl.filter_map_inplace
    (fun epoch_key epoch ->
      if String.starts_with ~prefix:(owner_id ^ "\000") epoch_key then None
      else Some epoch)
    epochs
