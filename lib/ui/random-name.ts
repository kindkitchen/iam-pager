// Compatibility projection: naming policy is runtime-neutral because page
// services also use it for generated duplicate locators.
export {
  CryptoRandomIndexSource,
  FourWordRandomNameGenerator,
  type RandomIndexSource,
  type RandomNameGenerator,
} from "../random-name.ts";
