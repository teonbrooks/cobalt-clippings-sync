# Cobalt Clippings Sync

An Obsidian plugin that pushes your [Obsidian Web Clipper](https://obsidian.md/clipper) notes to the **Clippings** app on a Kobo e-reader running [Cobalt](https://github.com/BandarLabs/Cobalt), and merges read/tag changes back into each note's frontmatter once you pull them back.

Read your clipping backlog on a Kobo, mark articles read and tag them from the device, and have that flow back into the exact notes in your vault — nothing to copy by hand, nothing to reconcile manually.

## Requirements

- A Kobo e-reader running [Cobalt](https://github.com/BandarLabs/Cobalt), with the **Clippings** app installed on it.
- The `kobo` command-line tool built or installed on the same computer that runs Obsidian (see [Cobalt's install instructions](https://github.com/BandarLabs/Cobalt/blob/main/docs/INSTALL.md)).
- Obsidian on desktop. This plugin shells out to `kobo`, so it cannot run on Obsidian mobile.
- Notes clipped with Obsidian Web Clipper, with `read` and `tags` frontmatter fields — which is what Web Clipper writes by default.

## Installing

This plugin isn't in Obsidian's official Community Plugins directory (yet), so install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install **BRAT** from Community Plugins if you don't already have it.
2. Open BRAT's settings, or run the command palette action **BRAT: Add a beta plugin for testing**.
3. Paste this repository's URL: `https://github.com/teonbrooks/cobalt-clippings-sync`.
4. Enable **Clippings Sync** under Community Plugins once BRAT finishes installing it.

BRAT will also keep it updated as new releases are published here.

## Finding your Kobo's IP address

The plugin needs to know your reader's address on your Wi-Fi network to reach it. The easiest way is to let Cobalt find it for you:

```sh
kobo devices
```

This scans your computer's own network for readers running Cobalt and prints their address, e.g.:

```
192.168.1.173  N873 · firmware 4.38.23697 · Cobalt 0.3.15
```

If nothing turns up, make sure the Kobo is awake and connected to the same Wi-Fi network as your computer — the radio goes down whenever the reader sleeps, so a reader that's been idle for a few minutes won't answer until you wake it. The address can also change the next time the reader reconnects (it's assigned by your router's DHCP), so re-run `kobo devices` if sync suddenly stops working.

You can also find it by hand: on the Kobo, go to **Settings → Wi-Fi**, tap the network you're connected to, and its IP address is shown there.

## Setup

Once installed, open **Settings → Clippings Sync** in Obsidian and fill in:

| Setting | What it is |
|---|---|
| **Kobo address** | The IP address from `kobo devices` above, e.g. `192.168.1.173`. |
| **kobo CLI path** | Path to the `kobo` binary. If it's on your `PATH`, the default `kobo` works as-is; otherwise give the full path (e.g. `/Users/you/codespace/Cobalt/target/release/kobo`). |
| **Clippings folder** | The folder in this vault where Web Clipper saves notes, relative to the vault root. Defaults to `Clippings`. |
| **Sync interval (minutes)** | How often to push and pull automatically while Obsidian is open. Set to `0` to turn off automatic syncing and sync only on demand. |

## Using it

- **Sync now** — the refresh icon in the left ribbon, or the command palette's **Sync with Kobo now (push, then pull)**. Pushes any unread notes to the device, then pulls back whatever was marked read or tagged since the last sync.
- **Push clippings to Kobo** / **Pull & merge changes from Kobo** — the same two steps individually, from the command palette, if you only want one direction.
- **Automatic sync** — runs on the interval you set, plus once when Obsidian starts. It fails silently on a quiet tick (the reader asleep or unreachable is normal, not an error); a manual sync reports what went wrong if something's actually broken.

Each sync reports how many notes were pushed or merged in a small notice in the bottom corner.

## How it works

- **Push** reads your vault's Web Clipper folder directly, finds notes marked `read: false`, and hands them to `kobo clippings push` to send to the device.
- **Pull** runs `kobo export --app clippings` to retrieve whatever the Clippings app has queued — which notes were marked read and which tags were added since the last sync — and merges each change into that note's frontmatter with Obsidian's own frontmatter editor, so an already-open note updates live and nothing else in the file is touched.

## Troubleshooting

- **"set the Kobo's address in Clippings Sync settings first"** — the Kobo address setting is empty; fill it in from `kobo devices`.
- **A sync fails with a `kobo` error** — check the "kobo CLI path" setting points at a real, executable `kobo` binary, and that `kobo doctor --device <address>` succeeds from a terminal on the same computer.
- **Push or pull silently does nothing** — the reader is very likely asleep. Wake it and try again, or use `kobo session --device <address> --wifi-always-on on --keep-awake on` while you work if you want it to stay reachable.

## License

MIT
