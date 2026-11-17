const { packager } = require('@electron/packager');
// aðeins arm64 (Apple Silicon) – x64 útgáfan er ekki notuð og tvöfaldar bara byggingartímann
const ARCH = 'arm64';
(async () => {
  const out = await packager({
    dir: '.', out: 'dist', overwrite: true, platform: 'darwin', arch: ARCH,
    electronZipDir: '/tmp/ezips', name: 'Mulehead', appBundleId: 'is.mulehead.app', appVersion: '1.5.6',
    icon: 'build/icon.icns', asar: true, extraResource: [`build/ffmpeg/darwin-${ARCH}/ffmpeg`], prune: false,
    appCategoryType: 'public.app-category.entertainment',
    darwinDarkModeSupport: true,
    ignore: [/^\/node_modules\/(?!sax(\/|$))/, /^\/dist/, /^\/build/, /^\/\.git/],
    extendInfo: {
      LSMinimumSystemVersion: '11.0',
      NSLocalNetworkUsageDescription: 'Mulehead notar heimanetið fyrir vefsíðuna þar sem þú setur inn playlista.',
      CFBundleDevelopmentRegion: 'is'
    }
  });
  console.log(out);
})();
