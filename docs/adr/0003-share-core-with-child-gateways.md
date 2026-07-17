# Share one core across child gateways

Taumel child sessions load ordinary Pi resources but receive Taumel tools through
a gateway-only inline binding that reuses the owning extension's initialized
OCaml core. They do not initialize the full Taumel extension recursively: a
second core is rejected by design, while allowing it would duplicate mutable
session authority. Child creation validates the assigned tool surface before
accepting work so a failed or incomplete binding fails closed.
