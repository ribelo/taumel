(* Closed grammar for brokered agent-worktree Git via exec_command. *)

type subcommand =
  | Status
  | Diff
  | Log
  | Show
  | Add
  | Restore_staged
  | Commit

type parse_error =
  | Not_simple_git
  | Unsupported_subcommand of string
  | Invalid_arguments of string
  | Permission_denied of string
  | Limits_exceeded of string

type parsed_command = {
  subcommand : subcommand;
  mutating : bool;
  argv : string list;
  commit_message : string option;
}

let max_argument_tokens = 256
let max_total_argument_bytes = 65_536
let max_revision_bytes = 1_024
let max_pathspec_bytes = 4_096
let max_commit_message_bytes = 16_384
let default_log_count = 100

let subcommand_to_string = function
  | Status -> "status"
  | Diff -> "diff"
  | Log -> "log"
  | Show -> "show"
  | Add -> "add"
  | Restore_staged -> "restore"
  | Commit -> "commit"

let error_message = function
  | Not_simple_git ->
      "brokered agent Git requires a simple git command with an allowed subcommand"
  | Unsupported_subcommand name ->
      "brokered agent Git does not support subcommand: " ^ name
  | Invalid_arguments message -> message
  | Permission_denied message -> message
  | Limits_exceeded message -> message

let has_control_character value =
  let length = String.length value in
  let rec loop index =
    if index >= length then false
    else
      match value.[index] with
      | '\x00' .. '\x1f' | '\x7f' -> true
      | _ -> loop (index + 1)
  in
  loop 0

let byte_length values =
  List.fold_left (fun acc value -> acc + String.length value) 0 values

let ensure_limits tokens =
  if List.length tokens > max_argument_tokens then
    Error (Limits_exceeded "brokered agent Git accepts at most 256 argument tokens")
  else if byte_length tokens > max_total_argument_bytes then
    Error
      (Limits_exceeded
         "brokered agent Git accepts at most 65536 total argument bytes")
  else Ok ()

let is_revision_or_object value =
  value <> ""
  && value.[0] <> '-'
  && (not (has_control_character value))
  && String.length value <= max_revision_bytes

let is_pathspec value =
  value <> ""
  && (not (has_control_character value))
  && String.length value <= max_pathspec_bytes

let take_after_separator tokens =
  let rec loop before = function
    | [] -> (List.rev before, None)
    | "--" :: rest -> (List.rev before, Some rest)
    | token :: rest -> loop (token :: before) rest
  in
  loop [] tokens

let validate_pathspecs = function
  | None -> Ok []
  | Some pathspecs ->
      if pathspecs = [] then
        Error (Invalid_arguments "pathspecs after -- must not be empty")
      else if List.for_all is_pathspec pathspecs then Ok pathspecs
      else Error (Invalid_arguments "invalid pathspec for brokered agent Git")

let option_has_value token =
  match String.index_opt token '=' with Some _ -> true | None -> false

let starts_with ~prefix value =
  let prefix_length = String.length prefix in
  String.length value >= prefix_length
  && String.sub value 0 prefix_length = prefix

let parse_status tokens =
  let ( let* ) = Result.bind in
  let options, pathspecs = take_after_separator tokens in
  let* pathspecs = validate_pathspecs pathspecs in
  let rec loop output_form branch untracked = function
    | [] -> Ok (output_form, branch, untracked)
    | "--short" :: rest when output_form = `Default ->
        loop `Short branch untracked rest
    | "--porcelain=v1" :: rest when output_form = `Default ->
        loop `Porcelain_v1 branch untracked rest
    | "--porcelain=v2" :: rest when output_form = `Default ->
        loop `Porcelain_v2 branch untracked rest
    | "--porcelain" :: rest when output_form = `Default ->
        loop `Porcelain_v1 branch untracked rest
    | "--branch" :: rest when not branch -> loop output_form true untracked rest
    | "-b" :: rest when not branch -> loop output_form true untracked rest
    | "--untracked-files=no" :: rest when untracked = None ->
        loop output_form branch (Some "no") rest
    | "--untracked-files=normal" :: rest when untracked = None ->
        loop output_form branch (Some "normal") rest
    | "--untracked-files=all" :: rest when untracked = None ->
        loop output_form branch (Some "all") rest
    | "-uno" :: rest when untracked = None ->
        loop output_form branch (Some "no") rest
    | "-unormal" :: rest when untracked = None ->
        loop output_form branch (Some "normal") rest
    | "-uall" :: rest when untracked = None ->
        loop output_form branch (Some "all") rest
    | token :: _ ->
        Error
          (Invalid_arguments
             ("unsupported git status option: " ^ token))
  in
  match loop `Default false None options with
  | Error _ as error -> error
  | Ok (output_form, branch, untracked) ->
      let argv = [ "status" ] in
      let argv =
        match output_form with
        | `Default -> argv
        | `Short -> argv @ [ "--short" ]
        | `Porcelain_v1 -> argv @ [ "--porcelain=v1" ]
        | `Porcelain_v2 -> argv @ [ "--porcelain=v2" ]
      in
      let argv = if branch then argv @ [ "--branch" ] else argv in
      let argv =
        match untracked with
        | None -> argv
        | Some value -> argv @ [ "--untracked-files=" ^ value ]
      in
      let argv =
        match pathspecs with
        | [] -> argv
        | values -> argv @ ("--" :: values)
      in
      Ok
        {
          subcommand = Status;
          mutating = false;
          argv;
          commit_message = None;
        }

let parse_diff tokens =
  let ( let* ) = Result.bind in
  let options, pathspecs = take_after_separator tokens in
  let* pathspecs = validate_pathspecs pathspecs in
  let rec loop staged output_mode exit_code no_renames unified revs = function
    | [] -> Ok (staged, output_mode, exit_code, no_renames, unified, List.rev revs)
    | ("--cached" | "--staged") :: rest when not staged ->
        loop true output_mode exit_code no_renames unified revs rest
    | "--exit-code" :: rest when not exit_code ->
        loop staged output_mode true no_renames unified revs rest
    | "--no-renames" :: rest when not no_renames ->
        loop staged output_mode exit_code true unified revs rest
    | token :: rest when starts_with ~prefix:"--unified=" token -> (
        match int_of_string_opt (String.sub token 10 (String.length token - 10)) with
        | Some n when n >= 0 && n <= 1000 && unified = None && output_mode = None
          ->
            loop staged (Some `Patch) exit_code no_renames (Some n) revs rest
        | _ ->
            Error
              (Invalid_arguments ("unsupported git diff option: " ^ token)))
    | token :: rest
      when List.mem token
             [
               "--patch";
               "--stat";
               "--shortstat";
               "--numstat";
               "--name-only";
               "--name-status";
               "--summary";
               "--check";
               "--quiet";
             ]
           && output_mode = None ->
        let mode =
          match token with
          | "--patch" -> `Patch
          | "--stat" -> `Stat
          | "--shortstat" -> `Shortstat
          | "--numstat" -> `Numstat
          | "--name-only" -> `Name_only
          | "--name-status" -> `Name_status
          | "--summary" -> `Summary
          | "--check" -> `Check
          | _ -> `Quiet
        in
        loop staged (Some mode) exit_code no_renames unified revs rest
    | token :: rest when is_revision_or_object token && List.length revs < 2 ->
        if staged && List.length revs >= 1 then
          Error (Invalid_arguments "git diff --cached accepts at most one revision")
        else loop staged output_mode exit_code no_renames unified (token :: revs) rest
    | token :: _ ->
        Error (Invalid_arguments ("unsupported git diff option: " ^ token))
  in
  match loop false None false false None [] options with
  | Error _ as error -> error
  | Ok (staged, output_mode, exit_code, no_renames, unified, revs) ->
      if Option.is_some unified && output_mode <> Some `Patch && output_mode <> None
      then Error (Invalid_arguments "--unified is only valid for patch diff output")
      else
        let argv = [ "diff" ] in
        let argv = if staged then argv @ [ "--cached" ] else argv in
        let argv =
          match output_mode with
          | None | Some `Patch ->
              (match unified with
              | Some n -> argv @ [ "--patch"; "--unified=" ^ string_of_int n ]
              | None -> if output_mode = Some `Patch then argv @ [ "--patch" ] else argv)
          | Some `Stat -> argv @ [ "--stat" ]
          | Some `Shortstat -> argv @ [ "--shortstat" ]
          | Some `Numstat -> argv @ [ "--numstat" ]
          | Some `Name_only -> argv @ [ "--name-only" ]
          | Some `Name_status -> argv @ [ "--name-status" ]
          | Some `Summary -> argv @ [ "--summary" ]
          | Some `Check -> argv @ [ "--check" ]
          | Some `Quiet -> argv @ [ "--quiet" ]
        in
        let argv = if exit_code then argv @ [ "--exit-code" ] else argv in
        let argv = if no_renames then argv @ [ "--no-renames" ] else argv in
        let argv = argv @ revs in
        let argv =
          match pathspecs with [] -> argv | values -> argv @ ("--" :: values)
        in
        Ok
          {
            subcommand = Diff;
            mutating = false;
            argv;
            commit_message = None;
          }

let parse_count_token token =
  if starts_with ~prefix:"-n" token && String.length token > 2 then
    int_of_string_opt (String.sub token 2 (String.length token - 2))
  else if starts_with ~prefix:"--max-count=" token then
    int_of_string_opt
      (String.sub token 12 (String.length token - 12))
  else if
    String.length token > 1
    && token.[0] = '-'
    && String.for_all
         (function '0' .. '9' -> true | _ -> false)
         (String.sub token 1 (String.length token - 1))
  then int_of_string_opt (String.sub token 1 (String.length token - 1))
  else None

let parse_log tokens =
  let ( let* ) = Result.bind in
  let options, pathspecs = take_after_separator tokens in
  let* pathspecs = validate_pathspecs pathspecs in
  let rec loop count detail oneline graph decorate first_parent reverse rev =
    function
    | [] ->
        Ok
          ( count,
            detail,
            oneline,
            graph,
            decorate,
            first_parent,
            reverse,
            rev )
    | "--oneline" :: rest when not oneline ->
        loop count detail true graph decorate first_parent reverse rev rest
    | "--graph" :: rest when not graph ->
        loop count detail oneline true decorate first_parent reverse rev rest
    | "--decorate=short" :: rest when not decorate ->
        loop count detail oneline graph true first_parent reverse rev rest
    | "--first-parent" :: rest when not first_parent ->
        loop count detail oneline graph decorate true reverse rev rest
    | "--reverse" :: rest when not reverse ->
        loop count detail oneline graph decorate first_parent true rev rest
    | token :: rest when parse_count_token token <> None && count = None -> (
        match parse_count_token token with
        | Some n when n >= 1 && n <= 1000 ->
            loop (Some n) detail oneline graph decorate first_parent reverse rev
              rest
        | _ ->
            Error (Invalid_arguments ("unsupported git log count: " ^ token)))
    | "-n" :: value :: rest when count = None -> (
        match int_of_string_opt value with
        | Some n when n >= 1 && n <= 1000 ->
            loop (Some n) detail oneline graph decorate first_parent reverse rev
              rest
        | _ -> Error (Invalid_arguments "git log count must be 1..1000"))
    | "--max-count" :: value :: rest when count = None -> (
        match int_of_string_opt value with
        | Some n when n >= 1 && n <= 1000 ->
            loop (Some n) detail oneline graph decorate first_parent reverse rev
              rest
        | _ -> Error (Invalid_arguments "git log count must be 1..1000"))
    | token :: rest
      when List.mem token [ "--patch"; "--stat"; "--name-only"; "--name-status" ]
           && detail = None ->
        loop count (Some token) oneline graph decorate first_parent reverse rev
          rest
    | token :: rest when rev = None && is_revision_or_object token ->
        loop count detail oneline graph decorate first_parent reverse
          (Some token) rest
    | token :: _ ->
        Error (Invalid_arguments ("unsupported git log option: " ^ token))
  in
  match loop None None false false false false false None options with
  | Error _ as error -> error
  | Ok (count, detail, oneline, graph, decorate, first_parent, reverse, rev) ->
      let count = Option.value count ~default:default_log_count in
      let argv = [ "log"; "--max-count=" ^ string_of_int count ] in
      let argv = if oneline then argv @ [ "--oneline" ] else argv in
      let argv =
        match detail with None -> argv | Some token -> argv @ [ token ]
      in
      let argv = if graph then argv @ [ "--graph" ] else argv in
      let argv =
        if decorate then argv @ [ "--decorate=short" ] else argv
      in
      let argv =
        if first_parent then argv @ [ "--first-parent" ] else argv
      in
      let argv = if reverse then argv @ [ "--reverse" ] else argv in
      let argv =
        match rev with None -> argv | Some value -> argv @ [ value ]
      in
      let argv =
        match pathspecs with [] -> argv | values -> argv @ ("--" :: values)
      in
      Ok
        {
          subcommand = Log;
          mutating = false;
          argv;
          commit_message = None;
        }

let parse_show tokens =
  let ( let* ) = Result.bind in
  let options, pathspecs = take_after_separator tokens in
  let* pathspecs = validate_pathspecs pathspecs in
  let rec loop oneline detail object_selector = function
    | [] -> Ok (oneline, detail, object_selector)
    | "--oneline" :: rest when not oneline ->
        loop true detail object_selector rest
    | token :: rest
      when List.mem token
             [ "--patch"; "--no-patch"; "--stat"; "--name-only"; "--name-status" ]
           && detail = None ->
        loop oneline (Some token) object_selector rest
    | token :: rest when object_selector = None && is_revision_or_object token ->
        loop oneline detail (Some token) rest
    | token :: _ ->
        Error (Invalid_arguments ("unsupported git show option: " ^ token))
  in
  match loop false None None options with
  | Error _ as error -> error
  | Ok (oneline, detail, object_selector) ->
      let argv = [ "show" ] in
      let argv = if oneline then argv @ [ "--oneline" ] else argv in
      let argv =
        match detail with None -> argv | Some token -> argv @ [ token ]
      in
      let argv =
        match object_selector with
        | None -> argv
        | Some value -> argv @ [ value ]
      in
      let argv =
        match pathspecs with [] -> argv | values -> argv @ ("--" :: values)
      in
      Ok
        {
          subcommand = Show;
          mutating = false;
          argv;
          commit_message = None;
        }

let parse_add tokens =
  let ( let* ) = Result.bind in
  match tokens with
  | "--all" :: rest ->
      let options, pathspecs = take_after_separator rest in
      if options <> [] then
        Error (Invalid_arguments "git add --all accepts no other options")
      else
        let* pathspecs =
          match pathspecs with
          | None -> Ok []
          | Some values -> validate_pathspecs (Some values)
        in
        let argv =
          match pathspecs with
          | [] -> [ "add"; "--all" ]
          | values -> [ "add"; "--all"; "--" ] @ values
        in
        Ok
          {
            subcommand = Add;
            mutating = true;
            argv;
            commit_message = None;
          }
  | "--" :: pathspecs ->
      let* pathspecs = validate_pathspecs (Some pathspecs) in
      if pathspecs = [] then
        Error (Invalid_arguments "git add requires at least one pathspec")
      else
        Ok
          {
            subcommand = Add;
            mutating = true;
            argv = "add" :: "--" :: pathspecs;
            commit_message = None;
          }
  | _ ->
      Error
        (Invalid_arguments
           "git add accepts only -- PATHSPEC... or --all [-- PATHSPEC...]")

let parse_restore tokens =
  let ( let* ) = Result.bind in
  match tokens with
  | "--staged" :: "--" :: pathspecs ->
      let* pathspecs = validate_pathspecs (Some pathspecs) in
      if pathspecs = [] then
        Error
          (Invalid_arguments "git restore --staged requires at least one pathspec")
      else
        Ok
          {
            subcommand = Restore_staged;
            mutating = true;
            argv = "restore" :: "--staged" :: "--" :: pathspecs;
            commit_message = None;
          }
  | _ ->
      Error
        (Invalid_arguments
           "git restore accepts only --staged -- PATHSPEC...")

let parse_commit tokens =
  let message =
    match tokens with
    | "-m" :: message :: [] -> Some message
    | "--message" :: message :: [] -> Some message
    | token :: [] when starts_with ~prefix:"--message=" token ->
        Some (String.sub token 10 (String.length token - 10))
    | _ -> None
  in
  match message with
  | None ->
      Error
        (Invalid_arguments
           "git commit accepts only -m/--message MESSAGE")
  | Some message ->
      let trimmed = String.trim message in
      if trimmed = "" then
        Error (Invalid_arguments "git commit message must be non-whitespace")
      else if String.length message > max_commit_message_bytes then
        Error
          (Limits_exceeded "git commit message exceeds 16384 bytes")
      else
        let message_ok =
          let length = String.length message in
          let rec loop index =
            if index >= length then true
            else
              match message.[index] with
              | '\n' | '\t' -> loop (index + 1)
              | '\x00' .. '\x1f' | '\x7f' -> false
              | _ -> loop (index + 1)
          in
          loop 0
        in
        if not message_ok then
          Error
            (Invalid_arguments "git commit message contains control characters")
        else
          Ok
            {
              subcommand = Commit;
              mutating = true;
              argv = [ "commit"; "--message"; message ];
              commit_message = Some message;
            }

let parse_tokens tokens =
  let ( let* ) = Result.bind in
  match tokens with
  | "git" :: subcommand :: rest ->
      let* () = ensure_limits (subcommand :: rest) in
      if subcommand = "" || subcommand.[0] = '-' then Error Not_simple_git
      else (
        match subcommand with
        | "status" -> parse_status rest
        | "diff" -> parse_diff rest
        | "log" -> parse_log rest
        | "show" -> parse_show rest
        | "add" -> parse_add rest
        | "restore" -> parse_restore rest
        | "commit" -> parse_commit rest
        | other -> Error (Unsupported_subcommand other))
  | _ -> Error Not_simple_git

let authorize ~read_only parsed =
  if read_only && parsed.mutating then
    Error
      (Permission_denied
         ("brokered agent Git subcommand is not allowed while read-only: "
        ^ subcommand_to_string parsed.subcommand))
  else Ok parsed

(* Per-identity broker lease: one active brokered Git process at a time. *)
module Lease = struct
  let held : (string, unit) Hashtbl.t = Hashtbl.create 16

  let try_acquire agent_id =
    let agent_id = String.trim agent_id in
    if agent_id = "" then Error "broker lease requires agent id"
    else if Hashtbl.mem held agent_id then
      Error "brokered agent Git is already running for this identity"
    else (
      Hashtbl.replace held agent_id ();
      Ok ())

  let release agent_id =
    let agent_id = String.trim agent_id in
    Hashtbl.remove held agent_id

  let is_held agent_id = Hashtbl.mem held (String.trim agent_id)

  let held_agent_ids () =
    Hashtbl.fold (fun agent_id _ acc -> agent_id :: acc) held []
end

(* Classify a shell AST as exactly one simple git command, or reject. *)
let simple_git_tokens_from_ast root =
  match Exec_policy.command_token_sequences_from_ast root with
  | Error message -> Error (Invalid_arguments message)
  | Ok [] -> Error Not_simple_git
  | Ok (_ :: _ :: _) -> Error Not_simple_git
  | Ok [ tokens ] -> (
      match tokens with
      | "git" :: _ -> Ok tokens
      | _ -> Error Not_simple_git)

let parse_simple_git_ast root =
  match simple_git_tokens_from_ast root with
  | Error _ as error -> error
  | Ok tokens -> parse_tokens tokens
