const source_url = new URL("./pre-push", import.meta.url);
const source = await Deno.readTextFile(source_url);

const command = new Deno.Command("git", {
  args: ["rev-parse", "--path-format=absolute", "--git-path", "hooks"],
  stdout: "piped",
  stderr: "piped",
});
const result = await command.output();
if (!result.success) {
  throw new Error("cannot locate repository hooks directory");
}

const hooks_directory = new TextDecoder().decode(result.stdout).trim();
if (hooks_directory.length === 0) {
  throw new Error("cannot locate repository hooks directory");
}
const target = `${hooks_directory}/pre-push`;
await Deno.mkdir(hooks_directory, { recursive: true });

try {
  const existing = await Deno.readTextFile(target);
  if (existing !== source) {
    throw new Error(
      "an unmanaged pre-push hook already exists; merge it with scripts/git-hooks/pre-push manually",
    );
  }
} catch (error) {
  if (!(error instanceof Deno.errors.NotFound)) throw error;
  await Deno.writeTextFile(target, source, { createNew: true });
}
await Deno.chmod(target, 0o755);
console.log("installed Git/GitButler pre-push verification hook");
