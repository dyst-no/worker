import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const releaseType = process.argv[2];
const validReleaseTypes = new Set(["patch", "minor", "major"]);

if (!validReleaseTypes.has(releaseType)) {
	console.error("Usage: bun run release:[patch|minor|major]");
	process.exit(1);
}

const run = (command, options = {}) =>
	execSync(command, {
		stdio: "inherit",
		...options,
	});

const capture = (command) =>
	execSync(command, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
	}).trim();

const readVersion = () =>
	JSON.parse(readFileSync("package.json", "utf8")).version;

const getCommitUrlBase = () => {
	const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
	const repositoryUrl = packageJson.repository?.url;

	if (!repositoryUrl) {
		return null;
	}

	return repositoryUrl
		.replace(/^git\+/, "")
		.replace(/\.git$/, "")
		.replace(/\/$/, "");
};

const getLastTag = () => {
	try {
		return capture("git describe --tags --abbrev=0");
	} catch {
		return null;
	}
};

const getCommitMessages = (lastTag) => {
	const range = lastTag ? `${lastTag}..HEAD` : "HEAD";
	const output = capture(
		`git log ${range} --reverse --pretty=format:%H%x09%h%x09%s`,
	);
	const commitUrlBase = getCommitUrlBase();

	if (!output) {
		throw new Error("No commits found to include in the changelog.");
	}

	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [hash, shortHash, subject] = line.split("\t");
			const commitRef = commitUrlBase
				? `[\`${shortHash}\`](${commitUrlBase}/commit/${hash})`
				: `\`${shortHash}\``;

			return `- ${subject} (${commitRef})`;
		})
		.join("\n");
};

const prependChangelog = (version, commitMessages) => {
	const date = new Date().toISOString().slice(0, 10);
	const changelogPath = "CHANGELOG.md";
	const existing = readFileSync(changelogPath, "utf8").trimEnd();
	const header = "# Changelog";
	const body = existing.startsWith(header)
		? existing.slice(header.length).trimStart()
		: `

${existing}`;
	const nextEntry = `## ${version} - ${date}

${commitMessages}`;
	const content = `${header}

${nextEntry}${
	body
		? `

${body}`
		: ""
}
`;

	writeFileSync(changelogPath, content);
};

const ensureCleanWorktree = () => {
	const status = capture("git status --porcelain");

	if (status) {
		throw new Error(
			"Release requires a clean git working tree. Commit or stash changes first.",
		);
	}
};

try {
	ensureCleanWorktree();

	const lastTag = getLastTag();
	const commitMessages = getCommitMessages(lastTag);

	run("bun run build");
	run("bun run typecheck");
	run(`npm version ${releaseType} --no-git-tag-version`);

	const version = readVersion();
	prependChangelog(version, commitMessages);

	run("git add package.json CHANGELOG.md");
	run(`git commit -m "chore(release): v${version}"`);
	run(`git tag v${version}`);
	run("npm publish");
	run("git push");
	run("git push --tags");
} catch (error) {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
}
