# Third-party notices

Pinwren's MIT packages bundle the third-party code listed below into the files they publish. Each component
is used under the licence named here; the licence texts follow. Dependencies that are only installed (not
bundled into a published file) carry their own notices in `node_modules` and are not repeated here.

Last reviewed: 2026-10-22 (wave 4).

## Bundled into `@pinwren/widget` (`widget.js` and its chunks)

| Component                                                                                                               | Version | Licence | Copyright                                                                                               | Where it ends up                                    |
| ----------------------------------------------------------------------------------------------------------------------- | ------- | ------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| [SnapDOM](https://github.com/zumerlab/snapdom) (`@zumer/snapdom`)                                                       | 3.3.6   | MIT     | Copyright (c) 2025 ZumerLab                                                                             | `widget-capture.<hash>.js` (screenshot engine)      |
| [finder](https://github.com/antonmedv/finder) (`@medv/finder`)                                                          | 4.0.2   | MIT     | Copyright (c) 2018 Anton Medvedev                                                                       | `widget.js` (CSS selector for anchors)              |
| [rrweb](https://github.com/rrweb-io/rrweb) (`@rrweb/record`, `rrweb`, `rrweb-snapshot`, `@rrweb/types`, `@rrweb/utils`) | 2.1.7   | MIT     | Copyright (c) 2018 Contributors (https://github.com/rrweb-io/rrweb/graphs/contributors) and SmartX Inc. | `widget-replay.<hash>.js` (session replay recorder) |
| [base64-arraybuffer](https://github.com/niklasvh/base64-arraybuffer) (inside rrweb's recorder)                          | 1.0.2   | MIT     | Copyright (c) 2012 Niklas von Hertzen                                                                   | `widget-replay.<hash>.js`                           |

## Adapted code

| Source                                              | Licence | Copyright                      | Adapted in                                                                                                                                                                                                                              |
| --------------------------------------------------- | ------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SitePing](https://github.com/NeosiaNexus/SitePing) | MIT     | Copyright (c) 2025 NeosiaNexus | `packages/widget/src/anchor.ts` — the anchoring approach (several independent locators per pin, `@medv/finder` with filters that skip CSS-in-JS / hashed class names and framework-generated ids). Re-implemented, not copied verbatim. |

No code from BugPin (AGPL-3.0) or any other copyleft project is included (ADR 0011). `perfect-freehand` is
not used: the annotation editor's pen tool is Pinwren's own.

## `@pinwren/react`

Bundles only Pinwren's own loader from `@pinwren/widget` (MIT). React is a peer dependency and is not bundled.

---

## MIT License

Applies to every component above, each under its own copyright line as listed.

```
MIT License

Copyright (c) <year> <copyright holders>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
