open Jsoo_bridge
open Runtime_access

let max_width = 2048
let max_height = 768
let max_base64_bytes = int_of_float (4.5 *. 1024. *. 1024.)
let jpeg_quality = 80

type candidate = {
  data : string;
  mime_type : string;
  encoded_size : int;
}

let js_require name =
  Unsafe.fun_call (Unsafe.js_expr "require") [| js_string name |]

let prepare params =
  with_gateway_authorized "view_media" (fun _sandbox ->
      let params = Tool_contracts.ViewMediaParams.t_of_js (ojs_of_js params) in
      let path = Tool_contracts.ViewMediaParams.get_path params in
      if String.trim path = "" then error_obj "view_media requires a non-empty path"
      else ok_obj [ ("action", js_string "view_media"); ("path", js_string path) ])

let int_value value = Option.map int_of_float (float_value value)

let int_prop obj name =
  match int_value (Unsafe.get obj name) with Some value -> value | None -> 0

let byte_at bytes index = int_prop bytes (string_of_int index)

let byte_length bytes =
  match int_value (Unsafe.get bytes "byteLength") with
  | Some value -> value
  | None -> int_prop bytes "length"

let has_prefix bytes values =
  byte_length bytes >= List.length values
  && (List.mapi (fun index expected -> byte_at bytes index = expected) values
     |> List.for_all Fun.id)

let ascii_at bytes index = Char.chr (byte_at bytes index)

let detect_mime_type bytes =
  let len = byte_length bytes in
  if has_prefix bytes [ 0x89; 0x50; 0x4e; 0x47; 0x0d; 0x0a; 0x1a; 0x0a ] then
    Some "image/png"
  else if len >= 3 && byte_at bytes 0 = 0xff && byte_at bytes 1 = 0xd8 && byte_at bytes 2 = 0xff then
    Some "image/jpeg"
  else if
    len >= 6
    && ascii_at bytes 0 = 'G'
    && ascii_at bytes 1 = 'I'
    && ascii_at bytes 2 = 'F'
    && ascii_at bytes 3 = '8'
    && (ascii_at bytes 4 = '7' || ascii_at bytes 4 = '9')
    && ascii_at bytes 5 = 'a'
  then Some "image/gif"
  else if
    len >= 12
    && ascii_at bytes 0 = 'R'
    && ascii_at bytes 1 = 'I'
    && ascii_at bytes 2 = 'F'
    && ascii_at bytes 3 = 'F'
    && ascii_at bytes 8 = 'W'
    && ascii_at bytes 9 = 'E'
    && ascii_at bytes 10 = 'B'
    && ascii_at bytes 11 = 'P'
  then Some "image/webp"
  else None

let resolve_path cwd path = Read_tool.resolve_path cwd path

let error_result ?path ?full_path message =
  let optional_fields =
    (match path with None -> [] | Some path -> [ ("path", js_string path) ])
    @
    match full_path with
    | None -> []
    | Some full_path -> [ ("fullPath", js_string full_path) ]
  in
  text_tool_result message
    (Unsafe.obj
       (Array.of_list
          ([ ("ok", js_bool false); ("error", js_string message) ]
          @ optional_fields)))

let buffer_from bytes =
  let buffer = Unsafe.get Unsafe.global "Buffer" in
  Unsafe.fun_call (Unsafe.get buffer "from") [| bytes |]

let base64_of_bytes bytes =
  match
    string_value
      (Unsafe.meth_call (buffer_from bytes) "toString" [| js_string "base64" |])
  with
  | Some value -> value
  | None -> failwith "unable to base64-encode image bytes"

let encode_candidate bytes mime_type =
  let data = base64_of_bytes bytes in
  { data; mime_type; encoded_size = String.length data }

let free_image image =
  try ignore (Unsafe.meth_call image "free" [||]) with _ -> ()

let get_dimension image name =
  match int_value (Unsafe.meth_call image name [||]) with
  | Some value -> value
  | None -> failwith ("invalid Photon image dimension: " ^ name)

let scaled_dimension value numerator denominator =
  int_of_float
    (floor
       ((float_of_int value *. float_of_int numerator /. float_of_int denominator)
       +. 0.5))

let fit_dimensions width height =
  let target_width = ref width in
  let target_height = ref height in
  if !target_width > max_width then (
    target_height := scaled_dimension !target_height max_width !target_width;
    target_width := max_width);
  if !target_height > max_height then (
    target_width := scaled_dimension !target_width max_height !target_height;
    target_height := max_height);
  (max 1 !target_width, max 1 !target_height)

let unique values =
  let rec loop seen acc = function
    | [] -> List.rev acc
    | value :: rest ->
        if List.mem value seen then loop seen acc rest
        else loop (value :: seen) (value :: acc) rest
  in
  loop [] [] values

let best_under_limit candidates =
  candidates
  |> List.filter (fun candidate -> candidate.encoded_size <= max_base64_bytes)
  |> List.sort (fun left right -> compare left.encoded_size right.encoded_size)
  |> List.find_opt (fun _ -> true)

let try_encodings photon image width height =
  let sampling_filter = Unsafe.get (Unsafe.get photon "SamplingFilter") "Lanczos3" in
  let resized =
    Unsafe.fun_call (Unsafe.get photon "resize")
      [|
        image;
        js_number (float_of_int width);
        js_number (float_of_int height);
        sampling_filter;
      |]
  in
  try
    let png = encode_candidate (Unsafe.meth_call resized "get_bytes" [||]) "image/png" in
    let jpeg_candidates =
      unique [ jpeg_quality; 85; 70; 55; 40 ]
      |> List.map (fun quality ->
             encode_candidate
               (Unsafe.meth_call resized "get_bytes_jpeg"
                  [| js_number (float_of_int quality) |])
               "image/jpeg")
    in
    free_image resized;
    png :: jpeg_candidates
  with exn ->
    free_image resized;
    raise exn

let resize_image photon image input_bytes mime_type =
  let original_width = get_dimension image "get_width" in
  let original_height = get_dimension image "get_height" in
  let input_base64_size = ((byte_length input_bytes + 2) / 3) * 4 in
  if
    original_width <= max_width
    && original_height <= max_height
    && input_base64_size <= max_base64_bytes
  then
    Ok
      ( encode_candidate input_bytes mime_type,
        original_width,
        original_height,
        original_width,
        original_height,
        false )
  else
    let start_width, start_height = fit_dimensions original_width original_height in
    let rec loop width height =
      match best_under_limit (try_encodings photon image width height) with
      | Some candidate ->
          Ok
            ( candidate,
              original_width,
              original_height,
              width,
              height,
              true )
      | None ->
          if width = 1 && height = 1 then
            Error "image could not be resized below the inline image size limit"
          else
            let next_width = if width = 1 then 1 else max 1 (width * 3 / 4) in
            let next_height = if height = 1 then 1 else max 1 (height * 3 / 4) in
            if next_width = width && next_height = height then
              Error "image could not be resized below the inline image size limit"
            else loop next_width next_height
    in
    loop start_width start_height

let success_result ~path ~full_path ~original_mime_type candidate ~original_width
    ~original_height ~width ~height ~was_resized ~byte_length =
  let dimension_text =
    if was_resized then
      Printf.sprintf "%dx%d -> %dx%d" original_width original_height width height
    else Printf.sprintf "%dx%d" width height
  in
  let text =
    Printf.sprintf "Viewed image `%s` (%s, %s)." path dimension_text
      candidate.mime_type
  in
  let details =
    Unsafe.obj
      [|
        ("ok", js_bool true);
        ("path", js_string path);
        ("fullPath", js_string full_path);
        ("mimeType", js_string candidate.mime_type);
        ("originalMimeType", js_string original_mime_type);
        ("originalWidth", js_number (float_of_int original_width));
        ("originalHeight", js_number (float_of_int original_height));
        ("width", js_number (float_of_int width));
        ("height", js_number (float_of_int height));
        ("wasResized", js_bool was_resized);
        ("byteLength", js_number (float_of_int byte_length));
        ("encodedBytes", js_number (float_of_int candidate.encoded_size));
        ("maxWidth", js_number (float_of_int max_width));
        ("maxHeight", js_number (float_of_int max_height));
        ("maxBytes", js_number (float_of_int max_base64_bytes));
      |]
  in
  Unsafe.obj
    [|
      ( "content",
        js_array
          [
            Unsafe.obj
              [| ("type", js_string "text"); ("text", js_string text) |];
            Unsafe.obj
              [|
                ("type", js_string "image");
                ("data", js_string candidate.data);
                ("mimeType", js_string candidate.mime_type);
              |];
          ] );
      ("details", inject details);
    |]

let view_media prepared runtime =
  let path = get_string prepared "path" in
  let cwd = get_string runtime "defaultCwd" in
  if String.trim path = "" then error_result "view_media requires a non-empty path"
  else
    let full_path = resolve_path cwd path in
    let fs = js_require "node:fs" in
    let stat_result =
      try Ok (Unsafe.fun_call (Unsafe.get fs "statSync") [| js_string full_path |])
      with exn -> Error (Printexc.to_string exn)
    in
    match stat_result with
    | Error error ->
        error_result ~path ~full_path
          (Printf.sprintf "unable to locate image at `%s`: %s" full_path error)
    | Ok stat ->
        let is_file =
          Js.to_bool (Unsafe.coerce (Unsafe.meth_call stat "isFile" [||]))
        in
        if not is_file then
          error_result ~path ~full_path
            (Printf.sprintf "image path `%s` is not a file" full_path)
        else
          let read_result =
            try Ok (Unsafe.fun_call (Unsafe.get fs "readFileSync") [| js_string full_path |])
            with exn -> Error (Printexc.to_string exn)
          in
          match read_result with
          | Error error ->
              error_result ~path ~full_path
                (Printf.sprintf "unable to read image at `%s`: %s" full_path error)
          | Ok input_bytes -> (
              match detect_mime_type input_bytes with
              | None ->
                  error_result ~path ~full_path
                    (Printf.sprintf
                       "unsupported image format at `%s`; supported formats are PNG, JPEG, GIF, and WebP"
                       full_path)
              | Some mime_type -> (
                  let photon_result =
                    try Ok (js_require "@silvia-odwyer/photon-node")
                    with exn -> Error (Printexc.to_string exn)
                  in
                  match photon_result with
                  | Error error ->
                      error_result ~path ~full_path
                        ("unable to load @silvia-odwyer/photon-node: " ^ error)
                  | Ok photon ->
                      let image_result =
                        try
                          Ok
                            (Unsafe.meth_call
                               (Unsafe.get photon "PhotonImage")
                               "new_from_byteslice" [| input_bytes |])
                        with exn -> Error (Printexc.to_string exn)
                      in
                      match image_result with
                      | Error error ->
                          error_result ~path ~full_path
                            (Printf.sprintf "image at `%s` is invalid: %s" full_path error)
                      | Ok image ->
                          let result =
                            try resize_image photon image input_bytes mime_type
                            with exn -> Error (Printexc.to_string exn)
                          in
                          free_image image;
                          (match result with
                          | Error error -> error_result ~path ~full_path error
                          | Ok
                              ( candidate,
                                original_width,
                                original_height,
                                width,
                                height,
                                was_resized ) ->
                              success_result ~path ~full_path
                                ~original_mime_type:mime_type candidate
                                ~original_width ~original_height ~width ~height
                                ~was_resized
                                ~byte_length:(byte_length input_bytes))))
