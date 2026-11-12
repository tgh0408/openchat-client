# Video Tools

OpenChat invokes FFmpeg and FFprobe as separate local processes for video
thumbnails and playback compatibility. Uploaded videos retain their original
bytes. The executables are runtime dependencies, not embedded in renderer JS.

## Packages

- `ffmpeg-static` version `5.3.0`: package license `GPL-3.0-or-later`.
  Keep `node_modules/ffmpeg-static/LICENSE`, the executable's `.LICENSE`
  and `.README`, and the corresponding source/build information with the
  directory distribution. The Windows x64 build installed for development is
  FFmpeg `6.1.1-essentials_build-www.gyan.dev`; its README identifies GPL v3
  and FFmpeg source revision `e38092ef93`. Other platforms can use different builds.
- `@ffprobe-installer/ffprobe` version `2.1.2`: installer license `LGPL-2.1`.
  Preserve the installer and selected `@ffprobe-installer/<platform>-<arch>`
  package, executable, license and source/build information. The installer's
  license alone does not describe every library linked into a binary.
  The Windows x64 platform package `5.1.0` identifies build
  `20230213-2296078` and license `GPL-3.0`.

Use `npm run setup` for the target platform. Include these external packages
and their binaries with the application; copying only `dist/` and
`dist-electron/` is insufficient. No runtime download or system PATH fallback
is implemented.

Before distributing, review the licenses of the actual binaries, provide the
applicable notices and corresponding source/build materials, and review
upstream security fixes. This notice is not a replacement for those materials
or a declaration that any particular distribution is compliant.
