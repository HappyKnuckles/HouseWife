/**
 * Dynamic app config — a thin layer over app.json, which stays the source of
 * truth for everything else.
 *
 * It exists for exactly one field. `google-services.json` is not committed:
 * the repo is public, and while the file is not a secret (Google documents
 * Firebase API keys as safe to ship, and it is extractable from any APK),
 * there is no reason to hand a fork this project's Firebase identity
 * pre-wired. So the file is local-only, and EAS gets its own copy as a
 * file-type environment variable:
 *
 *   npx eas env:set --name GOOGLE_SERVICES_JSON --type file \
 *     --value ./google-services.json --visibility secret \
 *     --environment development --environment preview --environment production
 *
 * During a build EAS writes that file to disk and sets the variable to its
 * path, which is what gets used below. Locally the variable is unset and the
 * fallback picks up the copy in the project root.
 *
 * Expo reads app.json first and passes the result in as `config`, so nothing
 * here has to restate the rest of the configuration.
 */
export default ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? './google-services.json',
  },
});
