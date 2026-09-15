import {
	App,
	FileSystemAdapter,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	normalizePath,
} from "obsidian";
import * as childProcess from "child_process";
import * as fsModule from "fs";
import * as osModule from "os";
import * as pathModule from "path";

/** Explicit shapes for exactly the Node APIs this plugin calls, so a type
 * checker that can't resolve `@types/node` (and so falls back to typing the
 * whole module `any`) still sees these as fully typed rather than letting
 * every downstream call and member access read as unsafe. */
interface ExecFileError {
	message: string;
}
const execFile: (
	command: string,
	args: readonly string[],
	options: { maxBuffer: number },
	callback: (error: ExecFileError | null, stdout: string, stderr: string) => void,
) => void = childProcess.execFile;
const fs: {
	mkdtemp(prefix: string): Promise<string>;
	readdir(path: string): Promise<string[]>;
	readFile(path: string, encoding: "utf8"): Promise<string>;
	rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void>;
} = fsModule.promises;
const path: { join(...segments: string[]): string } = pathModule;
const os: { tmpdir(): string } = osModule;

interface ClippingsSyncSettings {
	deviceHost: string;
	koboPath: string;
	clippingsFolder: string;
	pollMinutes: number;
}

const DEFAULT_SETTINGS: ClippingsSyncSettings = {
	deviceHost: "",
	koboPath: "kobo",
	clippingsFolder: "Clippings",
	pollMinutes: 20,
};

interface PendingEdit {
	path: string;
	read: boolean;
	added_tags: string[];
}

// The Cobalt CLI's `kobo export` names the received file from the export's
// title, sanitized to plain characters. `apps/clippings` always publishes
// its sync export titled "Clippings sync", so this is deterministic, not a
// guess — see `Export::new`'s title in apps/clippings/src/main.rs and
// `filename()` in crates/kobo-cli/src/exports.rs.
const EXPORT_TITLE = "Clippings sync";

function run(command: string, args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(
			command,
			args,
			{ maxBuffer: 64 * 1024 * 1024 },
			(error, stdout, stderr) => {
				if (error) {
					reject(new Error(stderr.trim() || stdout.trim() || error.message));
				} else {
					resolve(stdout);
				}
			},
		);
	});
}

export default class ClippingsSyncPlugin extends Plugin {
	settings: ClippingsSyncSettings = DEFAULT_SETTINGS;
	private pollHandle: number | null = null;

	async onload() {
		await this.loadSettings();

		this.addRibbonIcon("refresh-cw", "Sync clippings with Kobo", async () => {
			await this.syncNow(true);
		});

		this.addCommand({
			id: "push-to-kobo",
			name: "Push clippings to Kobo",
			callback: async () => {
				await this.guarded(() => this.push(), "Push");
			},
		});

		this.addCommand({
			id: "pull-from-kobo",
			name: "Pull & merge changes from Kobo",
			callback: async () => {
				await this.guarded(() => this.pull(), "Pull");
			},
		});

		this.addCommand({
			id: "sync-with-kobo",
			name: "Sync with Kobo now (push, then pull)",
			callback: async () => {
				await this.syncNow(true);
			},
		});

		this.addSettingTab(new ClippingsSyncSettingTab(this.app, this));

		this.armPolling();
		// Give Obsidian a moment to finish indexing the vault before the
		// first background sync reads it.
		this.registerInterval(
			window.setTimeout(() => {
				void this.syncNow(false);
			}, 15_000),
		);
	}

	onunload() {
		this.disarmPolling();
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<ClippingsSyncSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, saved ?? {});
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.armPolling();
	}

	armPolling() {
		this.disarmPolling();
		const minutes = this.settings.pollMinutes;
		if (!Number.isFinite(minutes) || minutes <= 0) {
			return;
		}
		this.pollHandle = window.setInterval(() => {
			void this.syncNow(false);
		}, minutes * 60_000);
		this.registerInterval(this.pollHandle);
	}

	disarmPolling() {
		if (this.pollHandle !== null) {
			window.clearInterval(this.pollHandle);
			this.pollHandle = null;
		}
	}

	/** Push then pull. `announce` controls whether a quiet failure (the
	 * reader asleep, nothing to sync) surfaces a Notice — on for a manual
	 * "sync now", off for the background poll, which should not nag every
	 * tick just because the Kobo is asleep. */
	private async syncNow(announce: boolean) {
		if (announce) {
			await this.guarded(() => this.push(), "Push");
			await this.guarded(() => this.pull(), "Pull");
		} else {
			await this.silently(() => this.push());
			await this.silently(() => this.pull());
		}
	}

	private async guarded(action: () => Promise<string>, label: string) {
		try {
			const message = await action();
			new Notice(`${label}: ${message}`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(`${label} failed: ${message}`);
		}
	}

	private async silently(action: () => Promise<string>) {
		try {
			await action();
		} catch {
			// Expected on a background tick: the reader can be asleep,
			// unreachable, or simply have nothing pending. A manual sync
			// (see `guarded`) is where a real problem should surface.
		}
	}

	private basePath(): string {
		const adapter = this.app.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			throw new Error("this vault is not on the local filesystem");
		}
		return adapter.getBasePath();
	}

	private requireDevice(): string {
		if (!this.settings.deviceHost.trim()) {
			throw new Error("set the Kobo's address in Clippings Sync settings first");
		}
		return this.settings.deviceHost.trim();
	}

	private async push(): Promise<string> {
		const device = this.requireDevice();
		const dir = path.join(this.basePath(), this.settings.clippingsFolder);
		const output = await run(this.settings.koboPath, [
			"clippings",
			"push",
			dir,
			"--device",
			device,
		]);
		return output.trim() || "pushed";
	}

	private async pull(): Promise<string> {
		const device = this.requireDevice();
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "clippings-sync-"));
		try {
			await run(this.settings.koboPath, [
				"export",
				"--app",
				"clippings",
				"--device",
				device,
				"--out",
				tmp,
			]);
			const entries = await fs.readdir(tmp);
			const received = entries.find((name) => name.startsWith(EXPORT_TITLE));
			if (!received) {
				return "nothing to merge";
			}
			const raw = await fs.readFile(path.join(tmp, received), "utf8");
			const edits = parsePendingEdits(raw);
			let merged = 0;
			for (const edit of edits) {
				if (await this.applyEdit(edit)) {
					merged += 1;
				}
			}
			return `merged ${merged} of ${edits.length} change(s)`;
		} finally {
			await fs.rm(tmp, { recursive: true, force: true });
		}
	}

	private async applyEdit(edit: PendingEdit): Promise<boolean> {
		const vaultPath = normalizePath(
			`${this.settings.clippingsFolder}/${edit.path}`,
		);
		const file = this.app.vault.getAbstractFileByPath(vaultPath);
		if (!(file instanceof TFile)) {
			return false;
		}
		await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
			frontmatter.read = edit.read;
			const existing = existingTags(frontmatter.tags);
			const merged = new Set(existing.map((tag) => tag.toLowerCase()));
			const tags = [...existing];
			for (const tag of edit.added_tags) {
				if (!merged.has(tag.toLowerCase())) {
					tags.push(tag);
					merged.add(tag.toLowerCase());
				}
			}
			frontmatter.tags = tags;
		});
		return true;
	}
}

/** A note's existing `tags` frontmatter, which Obsidian may store as a list,
 * a single string, or leave unset. */
function existingTags(tags: unknown): string[] {
	if (Array.isArray(tags)) {
		return tags.filter((tag): tag is string => typeof tag === "string");
	}
	if (typeof tags === "string" && tags) {
		return [tags];
	}
	return [];
}

function parsePendingEdits(raw: string): PendingEdit[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("the reader sent a sync file this plugin could not read");
	}
	const edits = (parsed as { edits?: unknown }).edits;
	if (!Array.isArray(edits)) {
		return [];
	}
	return edits
		.filter(
			(edit): edit is PendingEdit =>
				typeof edit === "object" &&
				edit !== null &&
				typeof (edit as PendingEdit).path === "string",
		)
		.map((edit) => ({
			path: edit.path,
			read: Boolean(edit.read),
			added_tags: Array.isArray(edit.added_tags)
				? edit.added_tags.filter((tag: unknown): tag is string => typeof tag === "string")
				: [],
		}));
}

class ClippingsSyncSettingTab extends PluginSettingTab {
	plugin: ClippingsSyncPlugin;

	constructor(app: App, plugin: ClippingsSyncPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Kobo address")
			.setDesc("The reader's IP address on your Wi-Fi (Settings > Wi-Fi on the Kobo).")
			.addText((text) =>
				text
					.setPlaceholder("192.168.1.173")
					.setValue(this.plugin.settings.deviceHost)
					.onChange(async (value) => {
						this.plugin.settings.deviceHost = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Kobo CLI path")
			.setDesc("Path to the built `kobo` binary from the Cobalt repository.")
			.addText((text) =>
				text
					.setPlaceholder("/Users/you/codespace/Cobalt/target/release/kobo")
					.setValue(this.plugin.settings.koboPath)
					.onChange(async (value) => {
						this.plugin.settings.koboPath = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Clippings folder")
			.setDesc("The Web Clipper folder in this vault, relative to the vault root.")
			.addText((text) =>
				text
					.setPlaceholder("Clippings")
					.setValue(this.plugin.settings.clippingsFolder)
					.onChange(async (value) => {
						this.plugin.settings.clippingsFolder = value || "Clippings";
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Sync interval (minutes)")
			.setDesc(
				"How often to push and pull automatically while Obsidian is open. Set to 0 to disable automatic syncing.",
			)
			.addText((text) =>
				text
					.setPlaceholder("20")
					.setValue(String(this.plugin.settings.pollMinutes))
					.onChange(async (value) => {
						const minutes = Number(value);
						this.plugin.settings.pollMinutes = Number.isFinite(minutes) ? minutes : 0;
						await this.plugin.saveSettings();
					}),
			);
	}
}
