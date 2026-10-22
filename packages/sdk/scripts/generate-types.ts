import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generate } from "./codegen";
import { HEADER, SPECS } from "./types";

const target = fileURLToPath(new URL("../src/types.generated.ts", import.meta.url));
writeFileSync(target, await generate(SPECS, HEADER, target));
console.log(`wrote ${target}`);
