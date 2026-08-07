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

Seven entries in `OperationIcons.ts`, mapped onto flow `type` values:

| Icon | Brand | Covers |
| --- | --- | --- |
| Variables `{x}` | `#770BD6` | `InitializeVariable`, `SetVariable`, `IncrementVariable`, `DecrementVariable`, `AppendToArrayVariable`, `AppendToStringVariable` |
| Condition | `#484F58` | `If` |
| Data operations `{∇}` | `#8C6CFF` | `Compose`, `ParseJson`, `Select`, `Join`, `Table`, `Query` |
| Schedule | `#1F85FF` | `Wait` |
| HTTP | `#709727` | `Http`, `HttpWebhook`, `ApiConnectionWebhook` |
| Request | `#007C89` | `Request`, `Response` |
| Terminate | `#F41700` | `Terminate` |

The brand colours are the designer's own values, taken from the same manifests. They
replaced hand-guessed approximations that were wrong for Control (`#484644`),
Terminate (`#a4262c`), Request (`#709727`) and Schedule (`#486991`).

## What is still missing

**`Scope`, `Foreach`, `Until` and `Switch` have no icon.**

They are not in the capture. Operation manifests are fetched **on demand**, so a
capture only contains what the captured page actually rendered — and the flow open at
capture time used none of those four. This was confirmed by scanning every `.js` file
in the full 96 MB capture, not just the one designer chunk, so it is an absence in the
capture rather than a gap in the search.

These four fall back to a control-grey (`#484F58`) tile with the type's initials —
`SC`, `FE`, `UN`, `SW`. That degrades cleanly: the card still reads correctly, it just
carries letters instead of a glyph.

### Filling the gap

1. Open a flow in the Power Automate designer that uses a Scope, an Apply to each, a
   Do until and a Switch. Expand each one so its manifest is fetched.
2. Save the page (a full "Save page as" mirror, including the `content.powerapps.com`
   bundles).
3. Run the extraction script against the new capture. It reports
   `not in this capture: ...` for whichever of the four are still absent, and confirms
   when all are present.
4. Generate the contact sheet, identify the new glyphs by eye, and add them to
   `OperationIcons.ts` — a `const` per icon plus entries in `BY_TYPE`.
5. Drop the corresponding entries from `TYPE_COLORS` in
   `src/features/flow-editor/FlowDiagram.ts`, which exists only to colour the types
   the icon table does not cover.

`src/tests/services/FlowDiagram.test.ts` has an `operation icons` block asserting the
precedence rules and the initials fallback; update the fallback test when a type stops
falling back.

## Provenance

These are Microsoft's icons, embedded verbatim (~16 KB total). The repository already
does this in `src/constants/ActionIcons.ts`, whose `HttpActionIcon` was taken from the
same designer payload; `OperationIcons.ts` follows that precedent. They are used to
depict the operations they belong to, in a tool for working with those operations.
