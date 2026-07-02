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
              pkgs.coreutils
              pkgs.git
              pkgs.gnumake
              pkgs.m4
              pkgs.opam
              pkgs.patch
              pkgs.pkg-config
              pkgs.python3
              pkgs.unzip
            ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
              pkgs.gmp
              pkgs.libffi
              pkgs.openssl
              pkgs.zlib
            ];
            text = ''
              switch_name="''${TAUMEL_OPAM_SWITCH:-${switchName}}"
              repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
              cd "$repo_root"

              eta_path="''${TAUMEL_ETA_PATH:-$repo_root/../ocaml/Eta}"
              if [ ! -d "$eta_path" ]; then
                echo "Eta checkout not found at $eta_path" >&2
                exit 1
              fi

              export OPAMROOT="''${OPAMROOT:-${sharedOpamRoot}}"
              export OPAMYES=1

              if [ ! -f "$OPAMROOT/config" ]; then
                opam init --bare --disable-sandboxing --yes
              fi

              if ! opam switch list --short | grep -Fxq "$switch_name"; then
                opam switch create "$switch_name" "ocaml-base-compiler.$switch_name" --yes
              fi

              export OPAMSWITCH="$switch_name"
              eval "$(opam env --switch "$switch_name" --set-switch)"

              eta_root="$(cd "$eta_path" && git rev-parse --show-toplevel)"
              eta_url="git+file://$eta_root#master"
              eta_packages="''${TAUMEL_ETA_PACKAGES:-eta eta_http eta_jsoo eta_http_js}"
              if [ "$#" -gt 0 ]; then
                eta_packages="$*"
              fi

              package_args=()
              for package in $eta_packages; do
                package_args+=("$package")
                opam pin add --kind=git "$package" "$eta_url" --no-action --yes
              done

              opam install "''${package_args[@]}" --assume-depexts --yes
              opam install . --deps-only --with-test --assume-depexts --yes

              echo "Taumel OPAM deps installed into switch: $switch_name"
              echo "Eta packages: $eta_packages"
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
            ] ++ pkgs.lib.optionals pkgs.stdenv.isLinux [
              pkgs.gmp
              pkgs.libffi
              pkgs.openssl
              pkgs.zlib
            ] ++ [
              setup
            ];
            inherit shellHook;
          };
        }
      );
    };
}
