module Constants = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val o_rdonly : t -> int [@@js.get "O_RDONLY"]
  val o_directory : t -> int [@@js.get "O_DIRECTORY"]
  val o_nofollow : t -> int [@@js.get "O_NOFOLLOW"]
  val x_ok : t -> int [@@js.get "X_OK"]
]

module Stats = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val is_file : t -> bool [@@js.call]
  val is_directory : t -> bool [@@js.call]
  val is_symbolic_link : t -> bool [@@js.call]
  val size : t -> float [@@js.get]
  val mode : t -> float [@@js.get]
  val dev : t -> Ojs.t [@@js.get]
  val ino : t -> Ojs.t [@@js.get]
]

module Dirent = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val name : t -> string [@@js.get]
  val is_directory : t -> bool [@@js.call]
  val is_file : t -> bool [@@js.call]
]

module Binding = [%js:
  type t = private Ojs.t
  val t_of_js : Ojs.t -> t
  val t_to_js : t -> Ojs.t
  val constants : t -> Constants.t [@@js.get]
  val exists_sync : t -> string -> bool [@@js.call]
  val stat_sync : t -> string -> Stats.t [@@js.call]
  val stat_sync_with : t -> string -> Ojs.t -> Stats.t [@@js.call "statSync"]
  val lstat_sync : t -> string -> Stats.t [@@js.call]
  val realpath_sync : t -> string -> string [@@js.call]
  val access_sync : t -> string -> int -> unit [@@js.call]
  val readdir_sync : t -> string -> string list [@@js.call]
  val readdir_sync_with : t -> string -> Ojs.t -> Ojs.t [@@js.call "readdirSync"]
  val mkdir_sync : t -> string -> Ojs.t -> unit [@@js.call]
  val read_file_sync_encoding : t -> string -> string -> string
    [@@js.call "readFileSync"]
  val read_file_sync : t -> string -> Ojs.t [@@js.call]
  val write_file_sync : t -> Ojs.t -> Ojs.t -> string -> unit [@@js.call]
  val append_file_sync : t -> string -> string -> string -> unit [@@js.call]
  val open_sync : t -> string -> Ojs.t -> Ojs.t [@@js.call]
  val open_sync_mode : t -> string -> Ojs.t -> int -> Ojs.t [@@js.call "openSync"]
  val close_sync : t -> Ojs.t -> unit [@@js.call]
  val write_sync : t -> Ojs.t -> string -> int [@@js.call]
  val fsync_sync : t -> Ojs.t -> unit [@@js.call]
  val unlink_sync : t -> string -> unit [@@js.call]
  val rmdir_sync : t -> string -> unit [@@js.call]
  val rename_sync : t -> string -> string -> unit [@@js.call]
  val symlink_sync : t -> string -> string -> unit [@@js.call]
  val link_sync : t -> string -> string -> unit [@@js.call]
  val readlink_sync : t -> string -> string [@@js.call]
  val copy_file_sync : t -> string -> string -> unit [@@js.call]
  val chmod_sync : t -> string -> int -> unit [@@js.call]
]

type fd = Ojs.t
type stats = Stats.t
type dirent = Dirent.t

let m = lazy (Binding.t_of_js (Node_require.require "fs"))
let force () = Lazy.force m

let constants () = Binding.constants (force ())
let o_rdonly () = Constants.o_rdonly (constants ())
let o_directory () = Constants.o_directory (constants ())
let o_nofollow () = Constants.o_nofollow (constants ())
let x_ok () = Constants.x_ok (constants ())

let exists_sync path = Binding.exists_sync (force ()) path
let stat_sync path = Binding.stat_sync (force ()) path
let stat_sync_bigint path =
  Binding.stat_sync_with (force ()) path
    (Ojs.obj [| ("bigint", Ojs.bool_to_js true) |])
let lstat_sync path = Binding.lstat_sync (force ()) path
let realpath_sync path = Binding.realpath_sync (force ()) path
let access_sync path mode = Binding.access_sync (force ()) path mode
let readdir_sync path = Binding.readdir_sync (force ()) path

let readdir_sync_with_file_types path =
  let options = Ojs.obj [| ("withFileTypes", Ojs.bool_to_js true) |] in
  Ojs.list_of_js Dirent.t_of_js
    (Binding.readdir_sync_with (force ()) path options)

let mkdir_sync ?(recursive = false) path =
  let options = Ojs.obj [| ("recursive", Ojs.bool_to_js recursive) |] in
  Binding.mkdir_sync (force ()) path options

let read_file_sync_utf8 path =
  Binding.read_file_sync_encoding (force ()) path "utf8"

let read_file_sync path = Binding.read_file_sync (force ()) path

let write_file_sync_string path contents =
  Binding.write_file_sync (force ()) (Ojs.string_to_js path)
    (Ojs.string_to_js contents) "utf8"

let write_file_sync_fd fd contents =
  Binding.write_file_sync (force ()) fd (Ojs.string_to_js contents) "utf8"

let append_file_sync path contents =
  Binding.append_file_sync (force ()) path contents "utf8"

let open_sync path flags =
  Binding.open_sync (force ()) path (Ojs.string_to_js flags)

let open_sync_mode path flags mode =
  Binding.open_sync_mode (force ()) path (Ojs.string_to_js flags) mode

let open_sync_flags path flags =
  Binding.open_sync (force ()) path (Ojs.int_to_js flags)

let close_sync fd = Binding.close_sync (force ()) fd
let write_sync fd text = Binding.write_sync (force ()) fd text
let fsync_sync fd = Binding.fsync_sync (force ()) fd
let unlink_sync path = Binding.unlink_sync (force ()) path
let rmdir_sync path = Binding.rmdir_sync (force ()) path
let rename_sync source destination =
  Binding.rename_sync (force ()) source destination
let symlink_sync target path = Binding.symlink_sync (force ()) target path
let link_sync source destination =
  Binding.link_sync (force ()) source destination
let readlink_sync path = Binding.readlink_sync (force ()) path
let copy_file_sync source destination =
  Binding.copy_file_sync (force ()) source destination
let chmod_sync path mode = Binding.chmod_sync (force ()) path mode

let is_file stats = Stats.is_file stats
let is_directory stats = Stats.is_directory stats
let is_symbolic_link stats = Stats.is_symbolic_link stats
let size stats = Stats.size stats
let mode stats = Stats.mode stats
let dev stats = Stats.dev stats
let ino stats = Stats.ino stats
let dirent_name dirent = Dirent.name dirent
let dirent_is_directory dirent = Dirent.is_directory dirent
let stats_to_js stats = Stats.t_to_js stats
