{
  description = "taumel OCaml/js_of_ocaml development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-darwin"
        "x86_64-linux"
      ];

      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          switchName = "5.4.1";
          sharedOpamRoot = "$HOME/.cache/opam";

          setup = pkgs.writeShellApplication {
            name = "taumel-opam-init";
            runtimeInputs = [
              pkgs.autoconf
              pkgs.cacert
              pkgs.git
              pkgs.gnumake
              pkgs.m4
              pkgs.opam
              pkgs.patch
              pkgs.pkg-config
              pkgs.python3
              pkgs.unzip
            ];
            text = ''
              switch_name="''${1:-${switchName}}"
              repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
              cd "$repo_root"

              eta_path="''${TAUMEL_ETA_PATH:-$repo_root/../ocaml/Eta}"
              if [ ! -d "$eta_path" ]; then
                echo "Eta checkout not found at $eta_path" >&2
                exit 1
              fi

              export OPAMROOT="''${OPAMROOT:-${sharedOpamRoot}}"
              export OPAMYES=1

              if [ ! -d "$OPAMROOT" ]; then
                opam init --bare --disable-sandboxing --no-setup --yes
              fi

              if ! opam switch list --short | grep -Fxq "$switch_name"; then
                opam switch create "$switch_name" "ocaml-base-compiler.$switch_name" \
                  --assume-depexts \
                  --yes
              fi

              export OPAMSWITCH="$switch_name"
              eval "$(opam env --switch "$switch_name" --set-switch)"

              opam pin add -n eta "$eta_path" --yes
              opam pin add -n eta_jsoo "$eta_path" --yes

              opam install . --deps-only --with-test --assume-depexts --yes
            '';
          };

          shellHook = ''
            export OPAMROOT="''${OPAMROOT:-${sharedOpamRoot}}"
            if [ -d "$OPAMROOT/${switchName}" ]; then
              export OPAMSWITCH="${switchName}"
              eval "$(opam env --switch "${switchName}" --set-switch)"
            fi

            if [ -t 1 ]; then
              echo "Shared OPAMROOT: $OPAMROOT"
              echo "Run 'taumel-opam-init' once to create or update the switch."
            fi
          '';
        in
        {
          default = pkgs.mkShell {
            packages = [
              pkgs.autoconf
              pkgs.cacert
              pkgs.git
              pkgs.gnumake
              pkgs.m4
              pkgs.nodejs
              pkgs.opam
              pkgs.patch
              pkgs.pkg-config
              pkgs.unzip
              pkgs.which
              setup
            ];
            inherit shellHook;
          };
        }
      );
    };
}

