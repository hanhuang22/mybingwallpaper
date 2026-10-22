import { projectVersion, validateReleaseRef } from "./release-safety.mjs";

validateReleaseRef({
  refType: process.env.GITHUB_REF_TYPE,
  tag: process.env.GITHUB_REF_NAME,
  version: await projectVersion(),
});
console.log(`Validated release ${process.env.GITHUB_REF_NAME}`);
