# Tickerkite: notes for Claude sessions

- Electron app, plain JS. Read README.md for features and layout.
- `npm test` must pass; rebuild the installed app with `npm run update`; back up with `git push` (private repo, branch `main`).
- Test with a separate copy so the user's data stays untouched: `npx electron . --user-data-dir=<scratch dir> --remote-debugging-port=9333`, driven by `scripts/cdp.mjs`.

## Obsidian project notebook (LLM wiki)
The user keeps a project notebook in Obsidian at `~/Documents/Tickerkite Vault`, laid out as a Karpathy-style LLM wiki:
- `raw/`: immutable sources (README snapshots, specs, data-source docs). Add to it, never edit existing files.
- `wiki/`: the notes you maintain: `index.md` (catalog of every note with a one-line summary, read it first), `log.md`, `Roadmap.md`, `Architecture.md`, `pages/` (one per app page), `decisions/`.
- `outputs/`: reports and answers generated from the wiki.
- `log.md` is a single append-only file: newest at the bottom, one `## YYYY-MM-DD` heading per day.

**Ingest (after each committed change, same turn):**
- append the change to `wiki/log.md` (reuse today's heading if it exists),
- update the affected note in `wiki/pages/`,
- record notable choices and their reasons in `wiki/decisions/`,
- tick off or add items in `wiki/Roadmap.md`,
- add any new note to `wiki/index.md`,
- keep frontmatter current: `updated:` on a page note when you change it; new pages get `type: page` and `code:`, new decisions `type: decision` and `date:`. `wiki/Backlog.md` (Dataview) reads these.
**Query:** read `wiki/index.md` first, then the notes it points to; only fall back to `raw/` for detail. Save a report or answer worth keeping to `outputs/<YYYY-MM-DD> <title>.md` (generated, never source of truth) and list it in the index's Outputs section; if it proves lasting, promote it into `wiki/` instead.
**Lint:** when asked (or now and then), look for orphan notes, broken `[[links]]`, notes missing from the index, and claims the code has since made stale.
Use Obsidian `[[wiki links]]` between notes; link to a day with `[[log#2026-11-02|2026-11-02]]`.

Keep the vault color-coded: pages orange, decisions green, log blue, hub notes (index, Roadmap, Architecture, Backlog) gold, raw purple, outputs teal. The colors are in `.obsidian/snippets/tickerkite-colors.css` and the `colorGroups` in `.obsidian/graph.json`. A new folder or hub note gets its own color in both places. Quit Obsidian before editing `graph.json` (it overwrites the file while open), then reopen it.

The vault is its own git repo (local backup); after an ingest, commit it there too: `git -C ~/Documents/Tickerkite\ Vault add -A && git -C ~/Documents/Tickerkite\ Vault commit -m "<change>"`.
