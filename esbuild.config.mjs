import esbuild from "esbuild";
import process from "process";
import { builtinModules } from "node:module";

const banner = `/* clippings-sync: built, not for direct editing. Edit main.ts instead. */`;

const production = process.argv[2] === "production";

const context = await esbuild.context({
	banner: { js: banner },
	entryPoints: ["main.ts"],
	bundle: true,
	external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtinModules],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: production ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
	minify: production,
});

if (process.argv[2] === "watch") {
	await context.watch();
} else {
	await context.rebuild();
	process.exit(0);
}
