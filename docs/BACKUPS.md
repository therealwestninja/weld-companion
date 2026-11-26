# Backups tab

## GitHub backup (Weld 1.91.2)

The GitHub tab's **Push** and **Push as pull request** commit the two editor panels
**and the open generator's `src/` files** into the generator's repo folder:
`<name>/<name>-top-panel.txt`, `<name>/<name>-html-panel.html` and
`<name>/src/<path>` for every src file. One atomic commit holds all of it, so a
failed upload cannot leave half a generator. The confirmation lists the src files
and their count. Files whose git blob hash already matches the branch are skipped;
nothing in the repo is deleted; `_weld-data/` is never touched. Src files over
4 MiB are stored as verified parts under `<name>/.weld-backup/` with a
`manifest.json` and `restore.py` (same format as below). Secret-shaped content
(private keys, GitHub/OpenAI/Anthropic/Hugging Face tokens) or `.env`/`.pem`/`.key`
paths abort the push. Browser caches, models, OPFS and chat databases are never
included. **Few requests:** Weld reads the branch head and the generator folder's hashes in two requests, skips unchanged files, then sends the changed ones as GraphQL `createCommitOnBranch` additions in batches of about 2 MB (at most 150 files) (one request per batch, not one per file); the progress box shows "batch k of n". If everything fits in one batch the push is a single atomic commit; if it needs more, the confirmation warns that it is not atomic, the two panels go in the last commit, and a stopped push can simply be repeated: press Push again and only the remaining files are sent. A batch that fails with 499/502/503/504 or a timeout is retried twice, then split in half. A generator with no src store pushes just the two panels; if src cannot
be read, the confirmation says so and offers the two panels only. Not yet tried in
a real userscript manager.

The earlier Tampermonkey request options are restored without a native timeout
option; an explicit 35-second watchdog remains to stop requests that never call
a handler.

### Restoring older full-project backups

Full-project backups made with earlier versions use `.weld-backup/manifest.json`
and verified 4 MiB parts for large files. Push never deletes older project or asset files.

To restore the exact source bytes from a downloaded/cloned backup,
run this inside the generator's folder (Python 3, standard library only):

```powershell
python .weld-backup/restore.py --output ..\restored-generator
```

Use a new output directory outside the generator folder. The tool checks the size
and SHA-256 of every part and refuses to overwrite existing files. Source files
restore under `src/`. Older backups containing cached models can still restore
them under `.weld-backup/assets/`. Browser cache reinstallation is not automated. The two
editor panel backups remain in the original generator folder.

For a local download that also captures readable cached assets/models, use Dev's
**Download all files and assets (this generator)**. This saves assembled files to
the computer save folder and enables automatic updates only for generators you
explicitly select; see [Folder sync](DEV.md#folder-sync).

**Local asset coverage limits:** a userscript cannot read the browser's ordinary HTTP disk
cache or other origins' storage. Private chat databases, IndexedDB, cookies,
credentials, `.env` and private-key files are excluded (a sensitive project path
aborts the push). Public cache capture accepts recognized static/model file URLs
on Perchance, Hugging Face, uploads and the supported library CDNs; API responses,
authenticated requests and signed URLs are excluded. This is a project/model
backup, not a browser-profile export. The manifest and confirmation report these
limits and unavailable storage APIs. Loading a model into a remote server does
not make its weights available in this browser.

Weld keeps no backups of its own (1.88.0). Generator vault saves pass straight through to a backup folder you choose; this tab shows, downloads, deletes and purges anything older that is still held in browser storage.

## Where copies live

A generator's vault save (`weld:genvault:<generator>/snapshot`, `chat/index`, `chat/snap-*`) is written straight into the **Backup location** folder and never into Weld's storage. When the generator reads or lists its vault, Weld answers from that folder (an older copy still in browser storage is used only for a key the folder does not have). With no folder chosen, or folder access not allowed, the save is refused with code `no-backup-folder` and the generator keeps its own copy. Chat copies still need **Settings > Skybridge > Let generators send chat copies** turned on. Each generator may write at most 30 files per 10 minutes and 500 files per folder (codes rate-limited, folder-full), and reads only accept files that generator stored itself.

## Backup location

1. Open Weld, **Backups**, **Backup location**, then **Choose folder...**. Pick any folder: a local drive, an external disk, or a folder inside Google Drive, OneDrive, iCloud Drive or Dropbox (the sync client uploads it).
2. After a browser restart press **Allow access** once (or leave **Keep access allowed** on and click anywhere); browsers require a click to re-grant folder access.
3. **Save all to folder now** (or the automatic option) copies anything older still in browser storage into the folder.

Needs Chrome or Edge (other browsers cannot open folders). The folder choice is remembered in the browser's IndexedDB (`weldCompanionBackupFolder`); the automatic setting is stored as `backupFolderAuto`.

Several computers can point at the same synced folder: each one's generators read the vault saves that are there. (The old **Check folder for new saves** import was removed in 1.88.0 because it copied records into Weld storage.)

## Studio projects and Scrapbook (1.89.0)

Studio projects (`studio:index:v1`, `studio:project:v1:<id>`) and the Scrapbook (`scrapbook`) are files in `<backup folder>/_weld-data/`, not in Weld storage. Each file is `{ "format": "weld-data", "v": 1, "key", "savedAt", "value" }`.

- **Moving existing data:** the first time folder access is allowed, Weld copies these keys out of browser storage, reads each file back to confirm it, and only then removes the storage copy. If the folder already has a key: Scrapbook entries and the Studio project list are merged by id; for a project the higher revision wins and the other version is written to `_weld-data/conflicts/`.
- **Saving:** edits are written to the folder about half a second later. Without a folder (or before access is allowed) Studio and Scrapbook can be read from any not-yet-moved copy but nothing is saved, and Weld says so.
- **Two tabs or computers:** if a file changed elsewhere since this tab read it, Weld keeps the newer file, shows it, and reports that your last edit was not saved. Files are re-read when the window regains focus.
- **Deleting** a Studio project removes its file. **Changing folder** does not move `_weld-data`; copy it yourself.
- **Move everything** (state export/import) still includes these keys.

## Delete and Purge

- **Delete** on a key removes that one key at once, with no confirmation. The opened sections and scroll position stay where they were. A generator's chat index is not edited.
- **Purge all Weld-stored backups** removes every backup Weld still holds in browser storage, in one click: all vault keys (including legacy `dadchat:vault:*`) and the Project tab's old `weldCompanionProjects` database (saved generator copies and snapshots). Small operational link and self-test records are kept. Anything not provably in the backup folder is saved first: into the folder when one is connected (chat copies with secret-shaped values, which never go to a folder, are downloaded instead), otherwise everything is downloaded as one `weld-backup-purged-<date>.json` file.
- The Project tab now keeps generator copies and snapshots for the open tab only; reloading clears them. Use its Download buttons to keep one.

### Layout

```
<your folder>/
  <generator>/snapshot/snapshot-YYYYMMDD-HHMMSS-xxxx.json   generator-source copies
  <generator>/chat/snap-<time>-<id>.json                    chat copies
  <generator>/chat/index-<hash>.json                        chat index versions
  <generator>/other/...                                     other keys under that generator
  _legacy/  _operational/                                   dadchat:vault:* and link/self-test keys
```

Each file is `{ "format": "weld-backup-record", "v": 1, "exportedAt", "record": { key, storedBy, size, stale, value } }`, the same shape as the Download buttons.

### Safety rules

- **Add-only.** A file is written only if its name does not exist yet. A changed record gets a new file (the name includes its time or a content hash), so an older copy is never overwritten. Weld never deletes anything in the folder, and **Disconnect folder** leaves it untouched.
- **Secrets stay out.** A chat copy whose config holds a plaintext secret-shaped value (api key, secret, token, webhook) is held back and listed in the card instead of being copied to a drive or cloud folder.
- Stale (null) records are skipped; unreadable ones are counted as failed.
- A generator deleting a copy (a null save) never deletes a file from the folder.

## Cleanup duplicates

**Find duplicates** compares the chat copies and source copies for each generator by their full content (not a hash alone).

- **Exact duplicates** are listed with the newest copy kept and the older ones pre-ticked. **Delete selected** first saves everything to your backup folder, reads each copy back from the folder and confirms its content matches, then removes only those keys and takes them out of the generator's chat index. It needs a backup folder with access allowed.
- **Possible duplicates** (same thread and message counts, different content) are only listed. Delete one with the per-key Delete button after checking it.
- **Ask the AI helper to review** opens the AI helper with a metadata-only report (key names, dates, counts; never chat text or settings). You press Ask yourself.
- Chat copies holding secret-shaped values are left out of cleanup because they are never copied to the folder.

## One place for your data: the GitHub repo (1.90.0)

Everything Weld keeps for you is now a file in your GitHub repo, in `_weld-data/` (the owner, repo, branch and token from Weld > GitHub). Nothing is kept in browser storage except settings and credentials (the token, AI keys, preferences). The earlier backup-folder store and the automatic local-folder writes are gone; the folder and the Dev tab's master folder are for manual exports only.

- **What is in the repo:** Studio projects, Scrapbook, notes, pins, capsules, sessions, tab snapshots, favorites, ratings, boundaries, output rules, lore and generator storage (`sbk:`), plus generator vault saves (`weld:genvault:...`). Clipboard history, time tracking, recents and other caches stay in memory for the page only.
- **Two computers:** every write carries the file's last-seen version. If another computer saved first, GitHub refuses the write, and Weld merges both sets of changes and retries: entries added on either side are kept, and an entry deleted on one side stays deleted. If the same entry was edited on both, the newer one wins and the other is saved under `_weld-data/conflicts/`. Weld re-reads the repo when the window gains focus and once a minute.
- **First run on a computer:** older copies in browser storage (and 1.89.x files in the backup folder) are imported only for keys the repo does not have. Any other older copy is filed under `_weld-data/legacy/` and removed from storage, so an old computer can never bring back something you deleted. History is in git.
- **Not saved without GitHub:** with no owner, repo and token set, edits to this data are refused with a message. Use a private repo: your notes and generator storage are stored there as readable JSON.
- Save in Perchance and Push still write the generator's panels as before.

## Dev master folder (Weld 1.92.0)

Since your work lives in the GitHub repo, the Dev tab's **Folder sync** panel is off by default. On first load a previously connected master folder is disconnected (the folder and its files are not touched). To use a local folder again, open Dev > Folder sync > **Show folder sync**, then choose the folder again. The setting is `showPanel` inside the stored `folderSync` config.
