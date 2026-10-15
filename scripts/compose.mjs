// Runs `docker compose` for one connection mode, or for every mode in turn with `all`, under the mode's own
// project name and with its RedisInsight override. Usage: node scripts/compose.mjs <mode|all> <compose args...>
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const MODES = ["standalone", "sentinel", "cluster"];
const infraDir = join(import.meta.dirname, "..", "infra");

const [target, ...composeArgs] = process.argv.slice(2);

if (target !== "all" && !MODES.includes(target)) {
  console.error(`Usage: node scripts/compose.mjs <${MODES.join("|")}|all> <compose args...>`);
  process.exit(2);
}

for (const mode of target === "all" ? MODES : [target]) {
  const { status, error } = spawnSync(
    "docker",
    [
      "compose",
      "-p", `showcase-${mode}`,
      "-f", join(infraDir, `${mode}.compose.yml`),
      "-f", join(infraDir, "insight", `${mode}.override.yml`),
      "--profile", "insight",
      ...composeArgs,
    ],
    { stdio: "inherit" },
  );
  if (error) {
    console.error(`Could not run docker: ${error.message}`);
    process.exit(1);
  }
  if (status !== 0) process.exit(status ?? 1);
}
