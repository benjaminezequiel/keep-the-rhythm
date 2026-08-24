import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const newVersion = process.argv[2];

if (!newVersion || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(newVersion)) {
	console.error("Usage: npm run version-bump -- <major.minor.patch>");
	process.exit(1);
}

function readJson(fileName) {
	const filePath = path.join(rootDir, fileName);
	return {
		filePath,
		data: JSON.parse(fs.readFileSync(filePath, "utf8")),
	};
}

function writeJson(filePath, data) {
	const existing = fs.readFileSync(filePath, "utf8");
	const indentation = existing.match(/^[ \t]+(?=\S)/m)?.[0] ?? "\t";
	fs.writeFileSync(filePath, `${JSON.stringify(data, null, indentation)}\n`);
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");

if (newVersion in versions.data) {
	console.error(`Version ${newVersion} already exists in versions.json`);
	process.exit(1);
}

packageJson.data.version = newVersion;
packageLock.data.version = newVersion;
packageLock.data.packages[""].version = newVersion;
manifest.data.version = newVersion;
versions.data[newVersion] = manifest.data.minAppVersion;

writeJson(packageJson.filePath, packageJson.data);
writeJson(packageLock.filePath, packageLock.data);
writeJson(manifest.filePath, manifest.data);
writeJson(versions.filePath, versions.data);

function runGit(args) {
	execFileSync("git", args, { cwd: rootDir, stdio: "inherit" });
}

runGit([
	"add",
	"package.json",
	"package-lock.json",
	"manifest.json",
	"versions.json",
]);
runGit(["commit", "-m", `version-bump: ${newVersion}`]);
runGit(["tag", newVersion]);
runGit(["push", "origin", "master"]);
runGit(["push", "origin", newVersion]);

process.stdout.write(`Updated plugin version to ${newVersion}\n`);
