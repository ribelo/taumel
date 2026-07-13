# Construct core-call results through discriminant-safe generated builders

Taumel constructs every OCaml-to-TypeScript core-call result through the
generated builder for its declared bridge contract. Generated builders own
literal discriminants instead of accepting them from callers, and the repository
gate rejects ad hoc boundary objects. This makes producer/decoder drift a build
failure rather than a runtime tool failure; the additional generation and gate
complexity is preferred over maintaining duplicate, weakly typed object shapes.
