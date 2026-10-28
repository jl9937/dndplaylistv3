{
  description = "D&D Playlist Manager dev environment";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
      in
      {
        devShells.default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_24 # Vite 8 needs Node >= 20.19; npm comes with it
            # Python helpers, if we ever need them, use uv:
            # pkgs.uv
          ];
        };
      });
}
