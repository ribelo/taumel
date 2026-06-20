(lang dune 3.21)
(generate_opam_files true)

(name taumel)
(authors "Rafal Krzywaznia")
(maintainers "Rafal Krzywaznia <r.krzywaznia@gmail.com>")
(license MIT)
(homepage "https://github.com/ribelo/taumel")
(bug_reports "https://github.com/ribelo/taumel/issues")

(package
 (name taumel)
 (synopsis "OCaml js_of_ocaml rewrite experiment for tau")
 (description
  "Taumel is a standalone OCaml/js_of_ocaml rewrite experiment for the tau pi extension.")
 (depends
  (ocaml (>= 5.2.0))
  (dune (>= 3.21))
  eta
  eta_jsoo
  (js_of_ocaml (>= 5.0))))
