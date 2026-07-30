type decoded = {
  plan_id : string;
  session_id : string;
  status : Plan_status.t;
  tasks : Plan_task.t list;
  blocks : Plan_block.t;
  tokens_used : int;
  time_used_seconds : int;
  time_limit_seconds : int option;
  extension_unlocked : bool;
  created_at : int;
  updated_at : int;
}

let encode ~plan_id ~session_id ~status ~tasks ~blocks ~tokens_used
    ~time_used_seconds ~time_limit_seconds ~extension_unlocked ~created_at
    ~updated_at =
  Shared.Object
    [
      ("planId", Shared.String plan_id);
      ("sessionId", Shared.String session_id);
      ("status", Shared.String (Plan_status.to_string status));
      ("tasks", Shared.Array (List.map Plan_task.to_json tasks));
      ("blocks", Plan_block.to_json blocks);
      ("tokensUsed", Shared.Number (float_of_int tokens_used));
      ("timeUsedSeconds", Shared.Number (float_of_int time_used_seconds));
      ("timeLimitSeconds", Shared.option_int_to_json time_limit_seconds);
      ("extensionUnlocked", Shared.Bool extension_unlocked);
      ("createdAt", Shared.Number (float_of_int created_at));
      ("updatedAt", Shared.Number (float_of_int updated_at));
    ]

let decode = function
  | Shared.Null -> Ok None
  | Shared.Object fields ->
      let string_field name =
        match List.assoc_opt name fields with
        | Some (Shared.String value) -> Ok value
        | _ -> Error (name ^ " must be a string")
      in
      let int_field name =
        match List.assoc_opt name fields with
        | Some (Shared.Number value)
          when Float.is_finite value
               && value = Float.round value
               && Float.abs value <= 2_147_483_647. ->
            Ok (int_of_float value)
        | _ -> Error (name ^ " must be a representable integer")
      in
      let option_int_field name =
        match List.assoc_opt name fields with
        | Some Shared.Null -> Ok None
        | Some (Shared.Number value)
          when Float.is_finite value
               && value = Float.round value
               && Float.abs value <= 2_147_483_647. ->
            Ok (Some (int_of_float value))
        | _ -> Error (name ^ " must be null or a representable integer")
      in
      let ( let* ) = Result.bind in
      let legacy_fields =
        [
          "goalId";
          "objective";
          "tokenBudget";
          "costBudget";
          "usageLimit";
          "usage_limited";
          "budget_limited";
        ]
      in
      let* () =
        match
          List.find_opt (fun name -> List.mem_assoc name fields) legacy_fields
        with
        | Some name -> Error ("incompatible legacy plan field: " ^ name)
        | None -> Ok ()
      in
      (* ^plan-w247: extensionUnlocked may be absent and defaults to locked. *)
      let fields_without_optional =
        List.filter
          (fun (name, _) -> name <> "extensionUnlocked" && name <> "blocks")
          fields
      in
      let* () =
        Shared.json_exact_fields "plan"
          [
            "planId";
            "sessionId";
            "status";
            "tasks";
            "tokensUsed";
            "timeUsedSeconds";
            "timeLimitSeconds";
            "createdAt";
            "updatedAt";
          ]
          fields_without_optional
      in
      let* plan_id = string_field "planId" in
      let* session_id = string_field "sessionId" in
      let* status_name = string_field "status" in
      let* tasks =
        match List.assoc_opt "tasks" fields with
        | Some value -> Plan_task.list_of_json value
        | None -> Error "tasks must be an array"
      in
      (* ^plan-ax49: old entries without blocks decode empty, then of_wire
         rejects an old blocked plan without an open entry. *)
      let* blocks =
        match List.assoc_opt "blocks" fields with
        | None -> Ok Plan_block.empty
        | Some value -> Plan_block.of_json value
      in
      let* status =
        Plan_status.of_wire ~name:status_name
          ~open_entry:(Plan_block.open_entry_opt blocks)
      in
      let* tokens_used = int_field "tokensUsed" in
      let* time_used_seconds = int_field "timeUsedSeconds" in
      let* time_limit_seconds = option_int_field "timeLimitSeconds" in
      let* extension_unlocked =
        match List.assoc_opt "extensionUnlocked" fields with
        | None -> Ok false
        | Some (Shared.Bool value) -> Ok value
        | Some _ -> Error "extensionUnlocked must be a boolean"
      in
      let* created_at = int_field "createdAt" in
      let* updated_at = int_field "updatedAt" in
      let* () =
        if String.trim plan_id = "" then Error "planId must not be empty"
        else if String.trim session_id = "" then
          Error "sessionId must not be empty"
        else if tokens_used < 0 then Error "tokensUsed must be non-negative"
        else if time_used_seconds < 0 then
          Error "timeUsedSeconds must be non-negative"
        else if created_at < 0 then Error "createdAt must be non-negative"
        else if updated_at < 0 then Error "updatedAt must be non-negative"
        else if updated_at < created_at then
          Error "updatedAt must not precede createdAt"
        else
          match time_limit_seconds with
          | Some limit when limit <= 0 ->
              Error "plan time limits must be positive when provided"
          | _ -> Ok ()
      in
      let* () =
        match (status, time_limit_seconds) with
        | Plan_status.Time_limited, Some limit when time_used_seconds >= limit
          ->
            Ok ()
        | Plan_status.Time_limited, _ ->
            Error "time_limited status requires a reached timeLimitSeconds"
        | _ -> Ok ()
      in
      Ok
        (Some
           {
             plan_id;
             session_id;
             status;
             tasks;
             blocks;
             tokens_used;
             time_used_seconds;
             time_limit_seconds;
             extension_unlocked;
             created_at;
             updated_at;
           })
  | _ -> Error "plan state must be an object or null"
