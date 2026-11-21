# SOLMARA

[![make.fun](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![rank](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/gaiaoagoaia-art/the-poster-for-a-place-that-i-2-20261121-0539-entry2/rank.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)
[![reward](https://make.fun/badge/the-poster-for-a-place-that-i-2-20261121-0539/gaiaoagoaia-art/the-poster-for-a-place-that-i-2-20261121-0539-entry2/reward.svg)](https://make.fun/bounty/the-poster-for-a-place-that-i-2-20261121-0539)

A travel poster for Solmara — an invented island lagoon where a giant stone
ring stands in turquoise water and frames the setting sun, while a second,
smaller sun hangs in the violet dusk sky above distant headlands. Two small
sailboats cross the lagoon beneath the ring, and the place name is set across
the top in a hand-drawn bitmap font, gold-ruled, over a sunset that runs from
deep violet through magenta to warm orange at the horizon.

## Run

Requires Node 22 or later, no dependencies:

```sh
node main.ts
```

This writes the poster to `/output/entry.png` — a deterministic 1024×1024 PNG
(identical bytes on every run), built with a hand-rolled canvas, bitmap font,
and PNG encoder using only the Node standard library.
