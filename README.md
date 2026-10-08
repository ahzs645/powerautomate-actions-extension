# Power Automate Actions Chrome Extension

[See how to install it now!](#how-to-install-the-tool)

The Power Automate Actions tool serves as a versatile solution for managing Power Automate actions. It offers the following functionalities:

## **1. Recording all HTTP requests from SharePoint**

 **Catching requests invoked directly from the SharePoint interface**

![Recorded Actions](/images/RecordDefaultSPActions.gif)


 **Recording requests invoked from the browser console**

![Recorded Actions](/images/RecordConsoleAction.gif)


 **Gathering requests executed with SP Editor**

![Recorded Actions](/images/RecordActionsFromSPEditor.gif)

<br />
<br />

## **2.	Duplicating actions in between tenants and environments**

Easily copy all actions from the "My Clipboard" section and paste them into the desired environment.

Actions copied inside the modern designer itself can be pulled into the extension too: copy an action in the designer, open the extension and press **Import from designer** on the *Copied Actions* tab. The import reads the system clipboard first (where the designer's copy handler writes) and falls back to the designer's `msla-clipboard` storage key for browsers without the async clipboard API.


![Copy Actions Between Environments](/images/CopyBetweenEnvs.gif)

<br />
<br />

## **3.	Coping actions from community blogs**

- Copy all actions stored on a page
- Copy individual actions using the provided copy button
- Check out [our article on bulb presence](https://michalkornet.com/2023/04/25/Bulb_Presence.html), for a reference.

![Copy Actions from blog](/images/CopyItemsFromBlogAndSaveOnFlow.gif)

<br />
<br />

## **4.	Storing actions in a more persistent way**
Copy actions from My *Clipboard Section*.

![Copy Actions from My Clipboard](/images/CopyMyClipboardActions.gif)

<br />
<br />

Using recorded and copied actions in Power Automate workflows.

Please note that in order to use the copied actions, you need to have the "My Clipboard" section open. 
Accepting the popup window will finish the action copying process.

![Paste Actions to my clipboard](/images/CopyItemsToMyClipboard.gif)

<br />
<br />


## **5.	Extended Copy/Paste feature for the new PowerAutomate editor**
In version 1.0.4 the new feature was added to the extension. It allows for store copied actions to the extension storage and choose which actions should be pasted to the workflow.

![Copy Paste Example](/images/CopyPasteExample.gif)

#### **How to install the tool?**

The tool is available on the Chrome Store [here](https://chrome.google.com/webstore/detail/power-automate-actions-ha/eoeddkppcaagdeafjfiopeldffkhjodl?hl=pl&authuser=0)  

The repository also includes the build package, allowing for direct installation.
To do so please unpack *[ApplicationBuild](https://github.com/mkm17/powerautomate-actions-extension/blob/main/ApplicationBuild.zip)* zip file and follow the steps described [here](https://support.google.com/chrome/a/answer/2714278?hl=en) to install the package locally on a browser. 


## **6. Utility function pack**

The extension bundles HTTP presets for the [File & Utility Azure Functions](https://github.com/) app — 42 endpoints covering PDF, Word, Excel, JSON array and image operations that Power Automate has no native action for (merge/split PDFs, regex find and replace, left joins, Excel sheet manipulation, zip/unzip, and so on).

Pick a preset from the **Predefined Actions** tab, hit *Insert into clipboard*, then paste with Ctrl+V in the modern Power Automate designer. The action arrives fully formed, with the request body already shaped for the endpoint.

### Pointing presets at your Function App

Presets ship with `{{functionBaseUrl}}` and `{{functionKey}}` placeholders. Under **Settings → Utility Function Pack**, set your Function App URL and choose how the key is handled:

- **Inline** — the key is stored in extension storage and written into each pasted action's URL. Convenient for quick work. The key is masked in the UI and always stripped from favorites exports.
- **Parameter references** — presets emit `@{parameters('AzureFunctionBaseUrl')}` and `@{parameters('AzureFunctionKey')}` instead, so no secret ever lands in the flow definition. Use this for anything solution-bound.

Until a base URL is set, the tab shows a warning and pasted actions keep their placeholders.

### Filling in parameters before pasting

The gear icon on any utility preset opens a parameter form built from that endpoint's real signature. Values starting with `@` are passed through as Power Automate expressions; everything else is sent literally. The generated action replaces the preset in the list, already selected.

### Companion Parse JSON actions

Enable *Add companion Parse JSON actions* to get a matching `Parse JSON` preset for every endpoint that returns structured data, with the schema pre-filled (file objects, file arrays, or the `{ values, no_value_loop_array }` wrapper).

### A note on four endpoints

`py_transform_array`, `py_filter`, `for_each_lookup` and `for_each_filter` pass the caller's expression to Python `eval()` with no sandbox — anyone holding the function key can execute arbitrary code on the Function App. They are excluded from the pack by default and must be opted into explicitly in Settings.

<br />

## **7. Tenant data scrubbing**

Copied and recorded actions carry more than the operation definition: the designer stores a drive-item-id to filename map under each action's `metadata`, connection GUIDs under `host.connection`, and any function key sits in plain sight in the URL. Sharing a favorites export therefore leaks a document inventory and live credentials.

Favorites exports are now scrubbed by default — drive item ids, SharePoint hostnames, file names, email addresses and query-string secrets are all removed, and the export confirmation reports what was taken out. The behaviour can be turned off under **Settings → Favorite Actions Management**.

<br />

## Available Scripts

### `npm test`

Launches the test runner in the interactive watch mode.\
See the section about [running tests](https://facebook.github.io/create-react-app/docs/running-tests) for more information.

### `npm run build`

The solution uses [craco](https://www.npmjs.com/package/@craco/craco) package to override webpack configuration. To build the solution use `npm run build` command. The build artifacts will be stored in the `build/` directory.
The build can be directly uploaded to local Chrome browser [guideline](https://support.google.com/chrome/a/answer/2714278?hl=en).

### `node scripts/extract-flow-presets.js <export.zip>`

Converts a Power Automate flow export into a predefined-actions pack, so any flow you already have becomes a reusable set of presets.

```bash
# Individual HTTP calls
node scripts/extract-flow-presets.js MyFlow.zip -o my-actions.json

# Whole scopes instead, tagged with a category
node scripts/extract-flow-presets.js MyFlow.zip --scopes --category "My Utils" -o my-actions.json

# Join scope recipes against the utility catalog: HTTP steps still pointing at
# the placeholder api/function_trigger_name route get the real route matched
# from the step's name (HTTP_Merge_PDFs -> merge_pdf_fitz)
node scripts/extract-flow-presets.js Solution.zip --scopes --merge-catalog src/data/utility-catalog.json -o my-recipes.json
```

Accepts a legacy flow export, a Dataverse solution export, or a bare `definition.json`. Every action is scrubbed on the way out (see *Tenant data scrubbing* above): query-string secrets become `{{functionKey}}` and `*.azurewebsites.net` origins become `{{functionBaseUrl}}`, so a shared pack can never point at the original author's Function App. Pass `--keep-secrets` only for a pack that will never leave your machine. Point the extension at the result via **Settings → Predefined Actions**, which now accepts one URL per line; `{{functionBaseUrl}}`/`{{functionKey}}` placeholders in remote packs are resolved against your configured Function App on load.

The bundled [utility-recipes.json](utility-recipes.json) pack was generated this way from the File & Utility Azure Functions solution export: 49 complete scope recipes (Get file content → HTTP → Create file, with the plumbing already wired) covering merge/split/rotate PDF, Word/HTML conversion, CSV/JSON/Excel transforms and more.

### `node scripts/extract-operation-icons.js <capture-dir>`

Inventories the built-in operation icons in a saved capture of the Power Automate designer, used to refresh [src/constants/OperationIcons.ts](src/constants/OperationIcons.ts).

```bash
node scripts/extract-operation-icons.js ~/Downloads/make.powerautomate.com \
  -o icons.json --sheet sheet.svg --dump-dir icons/
```

Connector actions (Office 365, Excel, …) get their icon from the flow's own `connectionReferences`, but built-in operations — Initialize variable, Condition, Compose, Terminate — have no connection reference, so their icons have to come from the designer bundle, where each operation manifest inlines one as an SVG data URI.

`Scope`, `Foreach`, `Until` and `Switch` currently have **no** icon and fall back to a grey tile with the type's initials: operation manifests load on demand, so a capture only contains what the captured page actually used. See [docs/operation-icons.md](docs/operation-icons.md) for how to fill that gap and for the provenance note.

## New Features

**Merged from upstream** ([mkm17/powerautomate-actions-extension](https://github.com/mkm17/powerautomate-actions-extension))
- Default predefined actions catalog loaded from the upstream `predefined-actions/` GitHub folder (file name becomes the category, cached for 1 hour, 24-hour back-off when GitHub rate-limits). Toggle it with **Settings → Load Default Actions**; it sits alongside the bundled utility pack and your own pack URLs, de-duplicated by id.
- New SharePoint site/web predefined actions.
- Importing favorites now merges with the existing list and skips duplicate ids instead of replacing it.
- The popup's runtime message listener is registered once and removed on unmount.

**2.3.0**
- Added a bundled utility function pack: 42 catalogued endpoints for the File & Utility Azure Functions app (38 enabled by default), pasteable directly into the modern editor.
- Added Function App URL and key configuration, with a choice between inline keys and `@{parameters(...)}` references.
- Added a parameter form for building an endpoint's request body before pasting.
- Added optional companion Parse JSON actions with pre-filled response schemas.
- Added category grouping and filtering to the Predefined Actions tab; search now matches descriptions too.
- Predefined Actions accepts multiple source URLs, each cached independently.
- Favorites exports are scrubbed of drive item ids, file names, tenant hostnames, email addresses and query-string secrets by default.
- Added `scripts/extract-flow-presets.js` for converting your own flow exports into packs.
- **Fixes**
- Pasting a Scope-type preset into the modern editor no longer throws on the missing `inputs.host` path.
- Actions sharing a title no longer overwrite one another in the clipboard payload; keys are now unique and space-free.
- An action with unparseable JSON is skipped rather than failing the whole batch.

**1.0.15**
- Adds predefined actions functionality.

**1.0.14**
- Export and import favorites functionality.

**1.0.13**
- Added a Settings tab with options to configure the maximum recording time and toggle the visibility of the action search bar.
- Added a setting to manually override page type detection.

**1.0.12**
- Added search functionality across all tabs to filter actions by title.
- Extended title column width for better readability of action titles.
- Added option to peek into action details via info button.

**1.0.11**
- Added Favorite Actions feature.
- Fix changed action property name in Modern Editor.

**1.0.10**
- Added recording capability on the SharePoint Admin page.
- Enabled the ability to copy actions within iframes (including the make.powerapps page and directly from Canvas Apps).
- **Fixes**
- Rendering record buttons on SharePoint modern pages – additional iframe fix.
- Fix action icons rendering

**1.0.7**
- Fixed pasting recorded actions into the new Power Automate editor.
- Added a notification banner.

**1.0.6**
- Added support for HTTP Microsoft Graph actions.
- Enabled recording of actions on Microsoft Graph Explorer and Classic SharePoint pages.
- Enhanced persistence of recorded actions.
- Fixed scrolling for actions.

**1.0.5**
- Fixed issue with storage of new editor Power Automate actions.

**1.0.4**
- Added support for copying actions from the new Power Automate editor.

**1.0.3**
- Improved handling of SharePoint requests using the _vti_bin endpoint.

