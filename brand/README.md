# Pinwren brand

The mark is a wren inside a map pin, with a speech bubble on its chest: the bird (Pinwren), the pin
(pointing at the page) and the comment, in one shape. The wordmark is set in a heavy geometric sans, and
the dot on the **i** echoes the pin.

## Files

| File                                   | Use                                                                 |
| -------------------------------------- | ------------------------------------------------------------------- |
| `pinwren-logo.svg`                     | Full logo on white or light backgrounds                             |
| `pinwren-logo-dark.svg`                | Full logo on navy or dark backgrounds (white letters)               |
| `pinwren-logo-mono.svg`                | One colour (navy), for print, embossing and single-colour contexts  |
| `pinwren-logo-reversed.svg`            | White on a navy tile                                                |
| `pinwren-mark.svg`                     | The mark alone, 48 px and up                                        |
| `pinwren-mark-mono.svg`                | The mark in navy only                                               |
| `pinwren-mark-small.svg`               | Simplified mark for 16–48 px: silhouette and eye, a longer point    |
| `favicon.ico`                          | 16, 32 and 48 px                                                    |
| `png/apple-touch-icon.png`             | 180 px, white tile                                                  |
| `png/icon-192.png`, `png/icon-512.png` | Web app manifest icons; `icon-512-maskable.png` has the safe zone   |
| `png/pinwren-logo-*.png`               | Raster logos (1200 px wide), and `pinwren-logo-email.png` for email |
| `social-preview.png`                   | 1280 × 640, for GitHub's social preview and launch posts            |
| `source/pinwren-logo-original.png`     | The original artwork the vectors were traced from                   |

Regenerate everything from the original with the scripts in `scripts/` (run them in order from that
folder after `npm i potrace@2 sharp svgo@3` in a scratch directory). `5-component-paths.mjs` writes
`brand-paths.ts`, which is copied to `apps/www/src/components/brand/paths.ts` and
`apps/web/src/components/brand/paths.ts`.

## Colour

| Name          | Hex       | Use                                                                        |
| ------------- | --------- | -------------------------------------------------------------------------- |
| Signal orange | `#F04424` | The logo, icons, pins, large accents and illustrations                     |
| Orange (text) | `#D63A1C` | Links, small orange text, filled buttons with white text on light surfaces |
| Orange (dark) | `#FF6A4D` | Orange text, links and accents on navy or dark surfaces                    |
| Deep navy     | `#17243A` | Text, the wordmark, dark backgrounds                                       |
| White         | `#FFFFFF` | Backgrounds                                                                |

Contrast (WCAG 2.2):

| Pair                             | Ratio  | OK for                                            |
| -------------------------------- | ------ | ------------------------------------------------- |
| Navy on white                    | 15.6:1 | Everything                                        |
| `#D63A1C` on white / white on it | 4.7:1  | Body text, links, button labels (AA)              |
| `#FF6A4D` on navy                | 5.5:1  | Body text and links on dark (AA)                  |
| `#F04424` on white               | 3.8:1  | Large text (24 px+, or 19 px bold) and icons only |
| `#F04424` on navy                | 4.1:1  | Large text and icons only                         |

The widget's default launcher colour is `#D63A1C`, so its white label passes AA on any page.

## Clear space and size

- Keep clear space around the logo equal to the height of the **i** dot on every side.
- Full logo: at least 96 px wide on screen. Below that, use the mark alone.
- Mark: 48 px and up. Below 48 px use `pinwren-mark-small.svg`; the speech lines and wing gaps vanish at that size.

## Do

- Use the files as they are, on white, light grey or navy.
- Put the mark on a white tile when the background is busy or a photo.
- Use the mono version when only one colour is available.

## Don't

- Recolour the bird (other than mono navy or reversed white), add gradients, outlines or shadows.
- Stretch, rotate or re-space the wordmark, or set "Pinwren" in another font next to the mark.
- Use `#F04424` for small text: use `#D63A1C` (light) or `#FF6A4D` (dark).
- Place the full-colour logo on orange or other saturated backgrounds.
