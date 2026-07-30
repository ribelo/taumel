module Effect = Eta.Effect
module Exit = Eta.Exit

type result = { code : int; stdout : string; stderr : string; killed : bool }

let nullish value = Ojs.is_null value || Ojs.type_of value = "undefined"

let error_code error =
  if nullish error then 0
  else
    let value = Ojs.get_prop_ascii error "code" in
    if Ojs.type_of value = "number" then int_of_float (Ojs.float_of_js value)
    else 1

let error_killed error =
  if nullish error then false
  else
    let value = Ojs.get_prop_ascii error "killed" in
    Ojs.type_of value = "boolean" && Ojs.bool_of_js value

let exec_file ~file ~args ~cwd ~env =
  Effect.async ~register:(fun resume ->
      let finished = ref false in
      let cleanup_waiter = ref None in
      let finish result =
        if not !finished then (
          finished := true;
          resume (Exit.Ok result);
          Option.iter (fun wake -> wake (Exit.Ok ())) !cleanup_waiter;
          cleanup_waiter := None)
      in
      let options =
        Node_child_process.utf8_options ~cwd ~env ~kill_signal:"SIGKILL"
          ~max_buffer:(16 * 1024 * 1024)
          ()
      in
      let process =
        Node_child_process.exec_file ~file ~args ~options
          (fun error stdout stderr ->
            finish
              {
                code = error_code error;
                stdout;
                stderr;
                killed = error_killed error;
              })
      in
      Some
        (Effect.async ~register:(fun wake ->
             if !finished then wake (Exit.Ok ())
             else (
               cleanup_waiter := Some wake;
               try ignore (Node_child_process.kill process "SIGKILL")
               with _ -> ());
             None)))
