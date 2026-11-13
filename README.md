# Inkvoice plugins

Plugins for this Inkvoice fork, kept in their own repo. The layout follows
[pigontech/inkvoice-plugins](https://github.com/pigontech/inkvoice-plugins):
one folder per plugin under `plugins/<id>/` with a `plugin.yaml` catalog
entry. Unlike pigontech's catalog, the plugin's code lives here too.

```
plugins/<id>/
  plugin.yaml   catalog entry (pigontech's schema)
  backend/      registerBackendPlugin(...): routes, migrations, listing
  frontend/     registerPlugin / registerRoute / registerNavItem, i18n
  tests/        bun:test, run from the app
```

## How it fits into the app

Inkvoice compiles plugins into the app; it can't download them. So the app
repo mounts this repo as a **git submodule** at `packages/inkvoice-plugins`
and imports each plugin once:

- `packages/backend/src/plugins/index.ts`: `import "../../../inkvoice-plugins/plugins/<id>/backend";`
- `packages/frontend/src/plugins/index.tsx`: `import "../../../inkvoice-plugins/plugins/<id>/frontend";`

Plugin code reaches the app through two aliases (see `tsconfig.json`; the
app's tsconfigs and Vite config carry the same ones):

- `@inkvoice/backend/*` → `packages/backend/src/*`
- `@/*` → `packages/frontend/src/*`

Rules that keep plugins safe to switch off:

- Own tables only, prefixed (`ld_` for Leads), created by the plugin's
  migrations. Read core tables if needed; never change them.
- Talk to other plugins through their services, not their tables.
- Routes live under `/api/v1/plugins/<id>` and return 404 while the plugin
  is off.

## Working on a plugin

From the app repo:

```bash
git clone --recursive git@github.com:heyronmar/inkvoice.git   # or: git submodule update --init
cd packages/inkvoice-plugins && git checkout main               # submodules start detached
# edit, then commit and push here first…
git commit -am "…" && git push
# …then record the new version in the app
cd ../.. && git add packages/inkvoice-plugins && git commit -m "chore: bump plugins"
```

`bun run check` in the app lints, type-checks and tests the plugins too.
When a plugin's code version changes, add a matching `versions` entry to its
`plugin.yaml`.

## Plugins

### Leads (`plugins/leads`)

A simple CRM pipeline. Off by default; switch it on under
Settings → Plugins.


Track potential customers from first contact to a won deal. Off by default.

- **Leads** hold a contact name, company, email, phone, source, estimated
  value, stage, next follow-up date and notes. Open leads sort by the soonest
  follow-up; overdue ones are flagged.
- **List or board**: a table with stage tabs, or a board you drag leads
  across to change their stage.
- **Your own pipeline** (Settings → Plugins → Leads): up to 8 working stages
  plus Won and Lost, which always come last. Add, rename, colour, reorder,
  hide or remove stages; a stage can only be removed once it's empty. The
  source list can be edited too.
- **Stage automations** (the ⚡ button on a board column or settings row,
  admins only). What a stage offers depends on where it sits:

  | Stage | Moves leads in when | When a lead arrives |
  |---|---|---|
  | First | Nothing: new leads start here | Set a follow-up |
  | Middle | One event, in pipeline order | Make a customer, set a follow-up |
  | Won | Quote accepted, invoiced or invoice paid | Make a customer, create a Time Tracking project |
  | Lost | Quote declined or expired | Nothing |

  Events follow the deal: follow-up set → quote created → sent → accepted →
  invoiced → paid. A stage can only use an event after every earlier
  stage's and before every later stage's; reordering stages turns off rules
  that no longer fit. Each event moves a lead once, when it happens, so a
  lead moved by hand stays put, and arrival actions never move a lead, so
  automations can't loop.
- **Quotes**: a lead follows its first quote. Its card shows the quote
  number and status and opens it, instead of offering another quote. The
  lead moves when the quote is saved, not when *Create quote* is clicked.
  If the quote is declined or expires, a newer quote for the customer takes
  its place and brings the lead back. Quote and invoice status is read
  lazily when leads are listed, so the core quote flow has no hooks.
- **Convert to customer** creates a customer from the lead (named after the
  company, or the contact if there is none). Converting twice reuses it.
- **Export** the filtered list as CSV.
- Uses the existing customer permissions: reading leads needs
  `customers:read`, exporting `customers:export`, editing
  `customers:create`/`update`/`delete`, and starting a quote also needs
  `invoices:create`. Changing the pipeline and automations is admin only.
