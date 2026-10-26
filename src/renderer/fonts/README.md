# Bundled fonts

IBM Plex Mono (Regular, Medium, SemiBold, Bold, Italic), (c) IBM Corp., licensed
under the SIL Open Font License 1.1 — https://github.com/IBM/plex

Shipped rather than relied on from the system because the CSP only allows
`font-src 'self'`, and a customer will not have it installed. Declared in
`styles/fonts.css`. The OFL requires the license text to travel with the font
when the app is distributed. The upstream licence is `LICENSE-IBMPlexMono.txt`
in this folder (added 2026-10-23).

Note: the Plex licence reserves the name "Plex". Any modified or subset copy
must not use that name (see PLAN-retro-demo.md, task 9.2).

## Headings: Ethos Pixel Sans (`ms-sans-serif/`)

A pixel recreation of the Windows 98 system font: the FontStructions
"MS Sans Serif" (https://fontstruct.com/fontstructions/show/1384746) and
"MS Sans Serif Bold" (https://fontstruct.com/fontstructions/show/1384862) by
"lou", licensed under Creative Commons Attribution-ShareAlike 3.0. Taken from the
98.css project (github.com/jdan/98.css, `fonts/src`). The files are renamed only;
the glyphs are unchanged. The licence and readme for each weight sit beside the
fonts and must ship with them. The share-alike term covers the font, not Ethos.

`styles/fonts.css` declares it as `Ethos Pixel Sans`. It is drawn on an 11px grid:
use it at 11, 22 or 33px.
