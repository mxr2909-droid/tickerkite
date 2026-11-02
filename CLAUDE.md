# Tickerkite: notes for Claude sessions

- Electron app, plain JS. Read README.md for features and layout.
- `npm test` must pass; rebuild the installed app with `npm run update`; back up with `git push` (private repo, branch `main`).
- Test with a separate copy so the user's data stays untouched: `npx electron . --user-data-dir=<scratch dir> --remote-debugging-port=9333`, driven by `scripts/cdp.mjs`.

## Obsidian project notebook
The user keeps a project notebook in Obsidian at `~/Documents/Tickerkite Vault`. After each committed change, update it in the same turn:
- add the change to `Log/<YYYY-MM-DD>.md` (create the day's note if needed and link it from `Home.md`),
- update the affected page note in `Pages/`,
- record notable choices and their reasons in `Decisions/`,
- tick off or add items in `Roadmap.md`.
Use Obsidian `[[wiki links]]` between notes.

Keep the vault color-coded: Pages orange, Decisions green, Log blue, hub notes (Home, Roadmap, Architecture) gold. The colors are in `.obsidian/snippets/tickerkite-colors.css` and the `colorGroups` in `.obsidian/graph.json`. A new folder or hub note gets its own color in both places. Quit Obsidian before editing `graph.json` (it overwrites the file while open), then reopen it.
