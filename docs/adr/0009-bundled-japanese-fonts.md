# Japanese fonts are bundled with the app

Still in force after [ADR-0010](0010-separate-web-and-mobile-apps.md): the subsetted woff2 slices move to `apps/web`, and the TTFs stay in `apps/mobile`.

Story text uses Noto Serif JP and the interface uses Noto Sans JP (SIL Open Font License). Both are shipped inside the app, loaded with `expo-font` on Android and served by our own server on web. We don't use Google Fonts or another CDN because this is a self-hosted app that shouldn't call third parties. We don't rely on system fonts because browsers and devices without a Japanese locale can fall back to Chinese glyph shapes. The cost is a larger download, so the web build must subset or lazy-load the fonts, and the font licence must be listed in `THIRD_PARTY_NOTICES.md`.
