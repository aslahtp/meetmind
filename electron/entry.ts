// Process entry point (`main` in package.json).
//
// `--smoke` is a headless self-test for CI (electron/smoke.js). It must run before anything else
// loads, because the config store opens the profile folder as soon as it is required, so main.js
// is only loaded when this is a normal launch.
if (process.argv.includes('--smoke')) {
  require('./smoke');
} else {
  require('./main');
}
