# H2oDigiGraph

**Cross-platform stream gage chart digitizer** — web, iOS, and Android.

Built for field hydrologists who need to digitize paper stage height charts from stream gage stations into digital CSV records.

---

## What it does

| Phase | Where | Action |
|-------|-------|--------|
| **Field** | Mobile (iOS / Android) | Photograph paper chart at the gage site, associate with a site record |
| **Office** | Web or mobile | Set axis boundaries, tap the curve to place digitization points, export daily CSV |

**Output:** average daily stage height CSV (`date, stage_height_ft`) ready for import into your hydrologic model or database.

---

## Tech stack

- **Expo SDK 55** (React Native + web via Metro bundler)
- **Expo Router** — file-based navigation, works on web and native
- **TypeScript** throughout
- **react-native-svg** — SVG overlay for the digitization canvas
- **expo-image-picker / expo-camera** — photo capture in the field
- **expo-location** — optional GPS tagging for field-captured chart images
- **expo-file-system + expo-sharing** — CSV export on native; browser download on web
- **AsyncStorage** — local-first storage (no account required to use)
- **Firebase (optional)** — Firestore + Storage cloud sync when configured

---

## Getting started

```bash
# Install dependencies
npm install

# Run on web
npm run web

# Run on Android (requires Android Studio or Expo Go)
npm run android

# Run on iOS (requires macOS + Xcode, or Expo Go)
npm run ios
```

Or scan the QR code with [Expo Go](https://expo.dev/go) after `npm run start`.

---

## Project structure

```
app/                        Expo Router screens
  _layout.tsx               Root Stack navigator
  index.tsx                 Site list (home)
  site/
    new.tsx                 Add a new gage site
    [id].tsx                Site detail + session list
  capture.tsx               Photo capture / image picker
  digitize/[sessionId].tsx  Digitization canvas + toolbar
  export/[sessionId].tsx    CSV preview + export

src/
  lib/
    types.ts                Shared TypeScript interfaces
    storage.ts              AsyncStorage helpers (sites, sessions)
    digitizer.ts            Pixel → real-world coordinate mapping + interpolation
    csvExport.ts            CSV builder + native/web share/download
    theme.ts                Colors, spacing, font sizes
  components/
    SiteCard.tsx            Site list item
    GraphCanvas.tsx         SVG overlay for placing boundary + digitization points
    BoundaryEditor.tsx      Form to enter axis min/max values and date range
```

---

## Workflow

1. **Add a site** — enter site name and agency code (e.g. USGS gage ID).
2. **Capture** — tap 📷 on the site detail screen to photograph the paper chart. Camera captures can attach GPS metadata when location permission is granted.
3. **Set boundaries** — tap **Set Bounds**, then tap the bottom-left axis corner and the top-right axis corner of the chart. Enter the matching real-world values (axis labels on the paper).
4. **Digitize** — tap **Digitize** mode, then tap along the stage height curve to place points. Tap a point to remove it.
5. **Export** — tap **Export CSV** to generate and share a daily stage height CSV.

---

## Roadmap

- [ ] Firebase auth and user-based permissions
- [ ] AI curve detection — auto-trace the chart curve using vision model
- [ ] Multi-year chart support
- [ ] USGS site lookup by code
- [ ] Offline-first PWA manifest

---

## Firebase setup

Cloud sync is optional. Without Firebase configured, the app remains fully local-first.

1. Create a `.env` file in the project root.
2. Copy the keys from [.env.example](.env.example).
3. Fill in your Firebase web app config values.
4. Restart Expo after changing environment variables.

Current cloud behavior:

- Site records sync to Firestore collection `sites`
- Session metadata syncs to Firestore collection `sessions`
- Chart images upload to Firebase Storage
- Local AsyncStorage remains the primary offline cache

---

## AI trace setup (optional)

The auto-trace flow can call a vision model to detect the chart line before falling back to local tracing heuristics.

1. Add these values to your `.env`:
  - `EXPO_PUBLIC_OPENAI_API_KEY`
  - `EXPO_PUBLIC_OPENAI_TRACE_MODEL` (default: `gpt-4.1-mini`)
2. Restart Expo after changing `.env`.

Notes:

- AI tracing currently runs on web where the app can send the image to the model endpoint.
- If the AI call fails or returns too few points, the app falls back to the built-in local tracer.
- For production, use a backend proxy to avoid exposing model API keys in browser clients.

---

## License

MIT
