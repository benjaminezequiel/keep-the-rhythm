import fs from "node:fs";
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

packageJson.data.version = newVersion;
packageLock.data.version = newVersion;
packageLock.data.packages[""].version = newVersion;
manifest.data.version = newVersion;
if (!(newVersion in versions.data)) {
	versions.data[newVersion] = manifest.data.minAppVersion;
}

writeJson(packageJson.filePath, packageJson.data);
writeJson(packageLock.filePath, packageLock.data);
writeJson(manifest.filePath, manifest.data);
writeJson(versions.filePath, versions.data);

process.stdout.write(`Updated plugin version to ${newVersion}\n`);
