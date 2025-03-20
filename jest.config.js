/** @type {import('ts-jest').JestConfigWithTsJest} **/
module.exports = {
  testEnvironment: "node",
  transform: {
    "^.+\.tsx?$": ["ts-jest", {}],
  },
  // Prevents tests from running twice
  testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
