# Built-in operation icons

How the flow diagram gets an icon for every card, where the built-in ones came
from, and what is still missing.

## Two sources of branding

A card in the Diagram tab needs an icon and an accent colour. They come from two
different places depending on the action:

| Action kind | Example | Icon source |
| --- | --- | --- |
| **Connector** | Office 365 Outlook, Excel, SharePoint | `connectionReferences[].iconUri` in the flow's own JSON |
| **Built-in** | Initialize variable, Condition, Compose, Terminate | `src/constants/OperationIcons.ts` |

Connector actions are easy: the flow definition already carries an `iconUri` and a
`brandColor` for each connection reference, and `FlowAnalyzer.getConnectorBranding()`
resolves them onto every action (and the trigger).

Built-in operations have **no connection reference at all**, so the flow JSON says
nothing about how they should look. Their icons exist only inside the designer
bundle. That is what `OperationIcons.ts` is for.

Precedence is resolved in `FlowDiagram.toNode()`: connector branding wins, then the
built-in table, then a grey-tile fallback with the type's initials.

## Where the built-in icons came from

They were extracted from a saved capture of `make.powerautomate.com`. Each built-in
operation ships a manifest with its icon inlined as an SVG data URI:

```js
o = new (n(15426).a)(() => ({
  properties: {
    iconUri: "data:image/svg+xml;base64,...",
    brandColor: "#484F58",
    description: "Identifies which block of actions to execute based on the ...",
    connector: { id: "connectionProviders/control", name: "Control" },
```

Two things make this harder than it sounds:

- **Source maps in a capture are usually fake.** A "Save page as" mirror returns the
  SPA shell for a missing `.map`, so the `.jssourcemap` files are 92-byte
  `"Please wait a bit"` stubs. There is nothing to un-minify against; the bundles are
  scanned as-is.
- **The manifests are spread across chunks and duplicated.** The same icon appears in
  several bundles, so results are de-duplicated by data URI.

`scripts/extract-operation-icons.js` does the scan:

```bash
node scripts/extract-operation-icons.js ~/Downloads/make.powerautomate.com \
  -o icons.json --sheet sheet.svg --dump-dir icons/
```

It walks every `.js` in the capture, pulls each manifest's `iconUri`, `brandColor`,
`description` and operation summaries, and prints an inventory. The `--sheet` option
writes a contact sheet — worth generating, because the descriptions alone are
ambiguous (`Create CSV table` and `Filter array` share one icon, and several
operations share the variables glyph).

## What is currently covered

Eleven entries in `OperationIcons.ts`, mapped onto flow `type` values:

| Icon | Brand | Covers |
| --- | --- | --- |
| Variables `{x}` | `#770BD6` | `InitializeVariable`, `SetVariable`, `IncrementVariable`, `DecrementVariable`, `AppendToArrayVariable`, `AppendToStringVariable` |
| Condition | `#484F58` | `If` |
| Data operations `{∇}` | `#8C6CFF` | `Compose`, `ParseJson`, `Select`, `Join`, `Table`, `Query` |
| Schedule | `#1F85FF` | `Wait` |
| HTTP | `#709727` | `Http`, `HttpWebhook`, `ApiConnectionWebhook` |
| Request | `#007C89` | `Request` (the trigger's own override) |
| Request glyph, Response colour | `#009DA5` | `Response` |
| Terminate | `#F41700` | `Terminate` |
| Scope | `#8C3900` | `Scope` |
| Loop | `#486991` | `Foreach`, `Until`, `Do_until` |
| Switch | `#484F58` | `Switch` |

The brand colours are the designer's own values, taken from the same manifests. They
replaced hand-guessed approximations that were wrong for Control (`#484644`),
Terminate (`#a4262c`), Request (`#709727`) and Schedule (`#486991`).

## The alias trap

`grep 'iconUri: "data:'` finds **9** icons in this capture. There are **106**.

Two manifest shapes exist:

```js
// newer designer - the URI is inline
iconUri: "data:image/svg+xml;base64,...", brandColor: "#484F58",

// classic designer - the URI is an alias
iconUri: y.default          // y is its own module: t.default = "data:image/svg+xml;..."
```

Every glyph in the classic designer is an anonymous webpack module whose entire body
is the data URI, referenced only through a minified alias. A literal grep returns zero
hits against that bundle even though every icon is present.

This produced a confident and wrong conclusion once: that `Scope`, `Foreach`, `Until`
and `Switch` were absent from the capture and would need a re-capture to obtain. They
were there the whole time. The scan had covered every `.js` file — the coverage claim
was true — but it was matching a pattern that structurally could not see them. Breadth
of search does not rescue the wrong pattern.

`scripts/extract-operation-icons.js` now reports both shapes and says how many icons it
found but cannot name. Naming an alias icon means resolving it through the webpack
dependency graph, or — far cheaper — generating the contact sheet and identifying the
glyphs by eye.

## Distinguishing the two kinds of "missing"

When an icon is not where you expect, separate these before acting:

| Symptom | Cause | Fix |
| --- | --- | --- |
| No manifest names it | Referenced by alias | Contact sheet, identify by eye |
| The chunk itself is absent | Never fetched by the captured page | Re-capture with that UI exercised |

`jsmap coverage <capture>` answers the second. Only that one needs a re-capture. The
extraction script no longer conflates them: it says "not named by any manifest here"
rather than implying absence.

## Brand colours have their own source

Colours do not depend on the icon manifests at all. The classic designer bundle carries
a named `brandColors` constant map covering the whole palette:

```
core.all.min.js → t.brandColors = {
  CONDITION: "#484F58",  CONTROL: "#8C3900",  DATA: "#8C6CFF",
  DATE_TIME: "#1F85FF",  HTTP:    "#709727",  LOOP: "#486991",
  RESPONSE:  "#009DA5",  SCOPE:   "#8C3900",  TERMINATE: "#F41700",
  VARIABLE:  "#770BD6",  WAIT:    "#1F85FF",  BUILT_IN: "#4D4F4F", ... }
```

Search this before hand-picking anything. It is also independently checkable: each
icon's own background fill equals its declared brand colour, so a value confirmed by
the constant map, a manifest, and the artwork is not a transcription error.

Note `Response` (`#009DA5`) differs from the "When a HTTP request is received" trigger
(`#007C89`), which overrides it. They share a glyph but not a colour.

## Provenance

These are Microsoft's icons, embedded verbatim (~16 KB total). The repository already
does this in `src/constants/ActionIcons.ts`, whose `HttpActionIcon` was taken from the
same designer payload; `OperationIcons.ts` follows that precedent. They are used to
depict the operations they belong to, in a tool for working with those operations.
