(** Shared helpers for building and merging plain JS objects (env maps, options). *)

let empty () = Ojs.empty_obj ()

let assign sources =
  let object_ctor = Ojs.get_prop_ascii Ojs.global "Object" in
  let assign_fn = Ojs.get_prop_ascii object_ctor "assign" in
  let args =
    Ojs.list_to_js
      (fun x -> x)
      (empty () :: sources)
  in
  Ojs.apply_arr assign_fn args

let of_fields fields = Ojs.obj (Array.of_list fields)

let string_field name value = (name, Ojs.string_to_js value)

let copy_field source name = (name, Ojs.get_prop_ascii source name)

let merge_string_fields base fields =
  assign [ base; of_fields (List.map (fun (n, v) -> string_field n v) fields) ]
