# Open Hex Assistant

Language: [中文](README.md) | English

An open-source recommendation prototype for League of Legends ARAM Mayhem.

This project is a clean-room implementation. It does not include license-key checks, device binding, paid-tier branches, telemetry lock-in, or closed-source core dependencies. The MVP uses public statistics and local-only state; recommendations, OCR, and overlay rendering run locally.

## Current MVP

- Select a League champion and fetch public ARAM Mayhem statistics.
- Rank items by win rate, pick rate, sample size, tier, and average purchase index.
- Rank champion-specific augments.
- Enter OCR text, augment names, or up to three candidate augment IDs to get an immediate three-choice order.
- Show each candidate augment with an `S+ / S / A / B / C / D` grade and a one-line reason.
- Run a transparent, always-on-top, mouse-pass-through Electron overlay for in-game display.
- Run a local ONNX PaddleOCR recognition worker against screen crops.

## Preview

![Control panel](preview.png)

![Overlay](overlay-preview.png)

![Calibration](calibration-preview.png)

## Data Sources

- Riot Data Dragon for champion and item metadata.
- `data.v2.iesdev.com` public ARAM Mayhem statistics.
- `hextech.dtodo.cn` public Chinese augment metadata.

These are third-party/public data sources, not an official Tencent or Riot product API.

## Run

Requires Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Open the control panel at:

```text
http://127.0.0.1:5173/
```

Open the browser overlay preview at:

```text
http://127.0.0.1:5173/?overlay=1
```

Run the desktop overlay shell after the dev server is already running:

```bash
npm run overlay:dev
```

The Electron overlay is transparent, frameless, always on top, and defaults to mouse passthrough. For manual UI testing:

```bash
npx cross-env OVERLAY_CLICK_THROUGH=0 npm run overlay:dev
```

Optional runtime inputs:

```bash
npx cross-env OVERLAY_CHAMPION=777 OVERLAY_CANDIDATES="秘术冲拳|质变：棱彩阶|会心治疗" npm run overlay:dev
```

If an external OCR process writes its latest result into a local JSON file, the overlay can watch that file:

```bash
cp runtime/overlay-state.example.json runtime/overlay-state.json
npx cross-env OVERLAY_STATE_FILE=runtime/overlay-state.json npm run overlay:dev
```

Expected JSON shape:

```json
{
  "championId": 777,
  "candidates": ["秘术冲拳", "质变：棱彩阶", "会心治疗"]
}
```

## Local ONNX OCR

The low-latency path is:

```text
screen capture -> crop three fixed title ROIs -> PaddleOCR ONNX recognition -> overlay state
```

It intentionally skips full-screen text detection. The three card locations are stable during augment selection, so calibrated title crops are the key to staying near the 500 ms target.

Prepare model files:

```bash
npm run ocr:models
```

This downloads the Chinese PP-OCRv4 recognition ONNX model and the matching PaddleOCR dictionary:

```text
models/paddleocr/ch_PP-OCRv4_rec_infer.onnx
models/paddleocr/ppocr_keys_v1.txt
```

The ONNX file is intentionally ignored by git. `npm run ocr:models` pins the downloaded ONNX and dictionary with SHA256 checks; set `PREPARE_PADDLEOCR_CONVERT=1` if you prefer converting from PaddleOCR's official inference tarball locally.

Prepare config:

```bash
cp runtime/ocr-config.example.json runtime/ocr-config.json
```

Probe one frame:

```bash
npm run ocr:probe
```

Run overlay with live OCR:

```bash
npm run dev
npm run overlay:ocr:dev
```

Calibrate the three title crop rectangles:

```bash
npm run dev
npm run calibrate:dev
```

In the calibration window, click `截取屏幕`, drag the three title rectangles onto the augment titles, then click `保存配置`. The saved file is `runtime/ocr-config.json`.

Useful knobs:

```bash
npx cross-env OCR_POLL_MS=80 npm run overlay:ocr:dev
npx cross-env OCR_DEBUG=1 npm run ocr:probe
npx cross-env PADDLEOCR_REC_MODEL=C:/path/rec.onnx PADDLEOCR_DICT=C:/path/ppocr_keys_v1.txt npm run ocr:probe
```

On Windows, the default OCR execution providers are:

```json
["dml", "cpu"]
```

DirectML accelerates ONNX Runtime on both NVIDIA and AMD GPUs through DirectX 12. Override only when needed:

```bash
npx cross-env OCR_EXECUTION_PROVIDERS=cpu npm run overlay:ocr:dev
npx cross-env OCR_EXECUTION_PROVIDERS=dml,cpu npm run overlay:ocr:dev
```

For the 500 ms target, keep League in borderless/windowed mode, calibrate `runtime/ocr-config.json` to crop only the three title strips, and keep the worker running so the ONNX session is already warmed.

## No Auth Design

There is no license-key check path. Future desktop builds should keep user identity out of the core recommendation pipeline:

- data cache: local JSON or IndexedDB
- OCR result: local process memory
- settings: local file
- updates: GitHub Releases or user-controlled download

## License

This project is licensed under the [MIT License](LICENSE).

## Next Steps

- Add item + augment conditional rules for strong archetypes such as Destroying Ritual and Critical Healing.
- Package Windows builds from GitHub Actions.
