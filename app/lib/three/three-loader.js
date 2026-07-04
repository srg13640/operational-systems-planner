/* Three.js loader — classic script (no <script type="module">).
   Chrome treats every file:// URL as a unique opaque origin, and ES-module
   fetching (both static "import ... from" and dynamic import() of a relative
   file:// path) goes through a CORS-checked load path that fails under that
   origin. blob: URLs are exempt — they are same-origin by construction — so
   the fix is to carry both module files as base64 strings in a plain classic
   script (three.module.b64.js, loaded before this file, safe over file:// the
   same way any classic <script src> is), decode them, and chain two blobs:

     1. three.core.min.js decodes straight to a Blob -> blob: URL (coreUrl).
     2. three.module.min.js is Three.js's *public* build, but it internally
        does `import ... from "./three.core.min.js"` — a relative specifier
        that can't resolve against a blob: base ("Invalid relative url or
        base scheme isn't hierarchical"). So its source is decoded as TEXT,
        every occurrence of that relative specifier is string-replaced with
        coreUrl, and the rewritten text is blobbed into its own blob: URL,
        which is what gets dynamic-imported.

   This works identically over file:// and http://, so there is no dual-path
   fallback to maintain. Regenerate both payloads after a Three.js version
   bump:
     node -e "const fs=require('fs');
       const mod=fs.readFileSync('three.module.min.js').toString('base64');
       const core=fs.readFileSync('three.core.min.js').toString('base64');
       fs.writeFileSync('three.module.b64.js',
         'window.__OSP_THREE_MODULE_B64=\"'+mod+'\";\nwindow.__OSP_THREE_CORE_B64=\"'+core+'\";\n')"
   Sets window.THREE and dispatches 'three-ready' (success) or
   'three-unavailable' (failure, e.g. WebGL disabled or a payload missing) on
   document — callers never need to poll. */
(function () {
  'use strict';

  function fail(err) {
    window.THREE = null;
    window.__OSP_THREE_ERROR = err;
    document.dispatchEvent(new Event('three-unavailable'));
  }

  function b64ToBlob(b64, mime) {
    var bin = atob(b64);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  var modB64 = window.__OSP_THREE_MODULE_B64;
  var coreB64 = window.__OSP_THREE_CORE_B64;
  if (!modB64 || !coreB64) { fail(new Error('three.module.b64.js did not load before three-loader.js')); return; }

  var coreUrl, moduleUrl;
  try {
    coreUrl = URL.createObjectURL(b64ToBlob(coreB64, 'text/javascript'));
    var moduleBin = atob(modB64);
    var moduleBytes = new Uint8Array(moduleBin.length);
    for (var i = 0; i < moduleBin.length; i++) moduleBytes[i] = moduleBin.charCodeAt(i);
    var moduleText = new TextDecoder('utf-8').decode(moduleBytes);
    /* Rewrite the internal relative import to the core blob: URL. Quote style
       is whatever the minifier emitted (checked against the vendored build:
       double-quoted, no spaces) — cover single-quote too in case a future
       Three.js release reformats. */
    moduleText = moduleText.split('"./three.core.min.js"').join('"' + coreUrl + '"');
    moduleText = moduleText.split("'./three.core.min.js'").join('"' + coreUrl + '"');
    moduleUrl = URL.createObjectURL(new Blob([moduleText], { type: 'text/javascript' }));
  } catch (e) {
    fail(e);
    return;
  }

  import(moduleUrl).then(function (mod) {
    window.THREE = mod;
    URL.revokeObjectURL(coreUrl);
    URL.revokeObjectURL(moduleUrl);
    document.dispatchEvent(new Event('three-ready'));
  }).catch(function (err) {
    URL.revokeObjectURL(coreUrl);
    URL.revokeObjectURL(moduleUrl);
    fail(err);
  });
})();
